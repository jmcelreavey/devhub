import type { ProcessHandle } from "../../local/ops/index";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import { getUpstartsDir } from "../content/dirs";
import { execExternal } from "../exec-external";
import { sanitizeUpstartRepoName } from "../repos/upstart";
import { PREVIEW_OWNERSHIP_REFUSED } from "../../../../../packages/shared/ui-lib/storyboard/types";

export const PREVIEW_CONFIG_NAME = "preview.json";
const DEFAULT_READY_SEC = 120;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css", ".gif": "image/gif", ".html": "text/html", ".ico": "image/x-icon",
  ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript", ".json": "application/json",
  ".mjs": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".wasm": "application/wasm", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
};

export const PreviewConfigSchema = z.object({
  autoStart: z.boolean(),
  kind: z.enum(["dev", "expo-web", "static"]).default("dev"),
  directory: z.string().trim().min(1).max(500).optional(),
  command: z.string().trim().min(1).max(500).optional(),
  trustCommand: z.boolean().optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  path: z.string().max(500).regex(/^\//).default("/"),
  readyTimeoutSec: z.number().int().min(10).max(600).default(DEFAULT_READY_SEC),
});
export type PreviewConfig = z.infer<typeof PreviewConfigSchema>;

export type PreviewResult =
  | { state: "starting"; url: null; reason: string }
  | { state: "started"; url: string; reason: string }
  | { state: "none"; url: null; reason: string };

interface LoadedConfig {
  config: PreviewConfig;
  fingerprint: string;
}

export function previewConfigPath(repoName: string): string {
  return path.join(getUpstartsDir(), sanitizeUpstartRepoName(repoName), PREVIEW_CONFIG_NAME);
}

function readProjectJson(cwd: string, name: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(cwd, name), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function hasDependency(pkg: Record<string, unknown> | null, name: string): boolean {
  return [pkg?.dependencies, pkg?.devDependencies, pkg?.peerDependencies].some(value => value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, name));
}

function detectedPreviewConfig(cwd: string): PreviewConfig | null {
  const pkg = readProjectJson(cwd, "package.json");
  const expo = isExpoProject(cwd);
  const command = expo ? "./node_modules/.bin/expo start --web --localhost --port {port}"
    : hasDependency(pkg, "next") ? "./node_modules/.bin/next dev --hostname 127.0.0.1 --port {port}"
      : hasDependency(pkg, "vite") ? "./node_modules/.bin/vite --host 127.0.0.1 --port {port} --strictPort"
        : null;
  return command ? PreviewConfigSchema.parse({ autoStart: true, kind: expo ? "expo-web" : "dev", trustCommand: true, command }) : null;
}

function createPreviewConfig(file: string, cwd: string): { reason: string } | null {
  const config = detectedPreviewConfig(cwd);
  if (!config) return { reason: "no browser preview was detected; add upstarts/<repo>/preview.json for this app" };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const root = fs.realpathSync(getUpstartsDir());
    if (fs.realpathSync(path.dirname(file)) !== path.join(root, path.basename(path.dirname(file)))) {
      return { reason: "the managed preview config directory must stay inside upstarts" };
    }
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    return { reason: "the managed preview config could not be created; check upstarts directory permissions" };
  }
}

function loadPreviewConfig(repoName: string | undefined, cwd?: string): LoadedConfig | { reason: string } {
  if (!repoName) return { reason: "the task has no repo to start a managed preview from" };
  const upstartName = repoName.match(/^[\w-]+\/([\w.-]+)$/)?.[1] ?? repoName;
  let file: string;
  try {
    file = previewConfigPath(upstartName);
  } catch {
    return { reason: "the task's repo name is not valid for a managed preview" };
  }
  if (!fs.existsSync(file)) {
    if (!cwd) return { reason: "the repo has no upstarts/<repo>/preview.json" };
    const failure = createPreviewConfig(file, cwd);
    if (failure) return failure;
  }
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    return { reason: "the managed preview config could not be read; check its permissions" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    return { reason: "the managed preview config is not valid JSON" };
  }
  const parsed = PreviewConfigSchema.safeParse(raw);
  if (!parsed.success) return { reason: "the managed preview config is invalid; check its fields" };
  if (!parsed.data.autoStart) return { reason: "the managed preview config has autoStart off" };
  return {
    config: parsed.data,
    fingerprint: createHash("sha256").update(file).update("\0").update(contents).digest("hex"),
  };
}

export function isExpoProject(cwd: string): boolean {
  if (hasDependency(readProjectJson(cwd, "package.json"), "expo")) return true;
  const app = readProjectJson(cwd, "app.json");
  return Boolean(app && Object.prototype.hasOwnProperty.call(app, "expo") && app.expo && typeof app.expo === "object" && !Array.isArray(app.expo));
}

function previewConfig(repoName: string | undefined, cwd: string | undefined): LoadedConfig | { reason: string } {
  const found = loadPreviewConfig(repoName, cwd);
  if ("reason" in found || found.config.kind === "static" || found.config.command) return found;
  if (cwd && isExpoProject(cwd)) {
    return { ...found, config: { ...found.config, kind: "expo-web", command: "npx --no-install expo start --web --port {port}" }, fingerprint: found.fingerprint + ":expo-web" };
  }
  return found;
}

export function readPreviewConfig(repoName: string | undefined): { config: PreviewConfig } | { reason: string } {
  const found = loadPreviewConfig(repoName);
  return "reason" in found ? found : { config: found.config };
}

interface Running {
  taskId: string;
  repoName?: string;
  configFingerprint: string;
  cwd: string;
  root: string;
  url: string;
  server: http.Server;
  startedAt: number;
  leases: number;
  revoked: boolean;
  dynamic?: DynamicPreview;
}

interface DynamicPreview {
  controller: AbortController;
  backendPort: number;
  groupId?: number;
  ready: boolean;
  exited: boolean;
  ownershipLost?: boolean;
}

interface LegacyRunning {
  child: ProcessHandle | null;
  taskId: string;
  url: string;
  ready: boolean;
  startedAt: number;
}

const KEY = Symbol.for("devhub.storyboard.previews");
const running: Map<string, Running | LegacyRunning> = ((globalThis as Record<symbol, unknown>)[KEY] as Map<string, Running | LegacyRunning> | undefined) ?? new Map();
(globalThis as Record<symbol, unknown>)[KEY] = running;
const STARTING_KEY = Symbol.for("devhub.storyboard.previews.starting");
const starting: Set<string> = ((globalThis as Record<symbol, unknown>)[STARTING_KEY] as Set<string> | undefined) ?? new Set();
(globalThis as Record<symbol, unknown>)[STARTING_KEY] = starting;
const GENERATIONS_KEY = Symbol.for("devhub.storyboard.previews.generations");
const generations: Map<string, number> = ((globalThis as Record<symbol, unknown>)[GENERATIONS_KEY] as Map<string, number> | undefined) ?? new Map();
(globalThis as Record<symbol, unknown>)[GENERATIONS_KEY] = generations;

function isCurrent(entry: Running | LegacyRunning): entry is Running {
  return "server" in entry;
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function staticRoot(cwd: string, directory: string): string | null {
  if (path.isAbsolute(directory)) return null;
  try {
    const checkout = fs.realpathSync(cwd);
    const root = fs.realpathSync(path.resolve(checkout, directory));
    return root !== checkout && inside(checkout, root) && fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function sendAsset(entry: Running, pathname: string, response: ServerResponse): void {
  if (entry.revoked) { response.writeHead(410).end(); return; }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end(); return;
  }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").some(part => part.startsWith("."))) {
    response.writeHead(403).end(); return;
  }
  try {
    const candidate = path.resolve(entry.root, "." + decoded);
    if (!inside(entry.root, candidate)) { response.writeHead(403).end(); return; }
    const resolved = fs.realpathSync(candidate);
    if (!inside(entry.root, resolved)) { response.writeHead(403).end(); return; }
    const file = fs.statSync(resolved).isDirectory() ? path.join(resolved, "index.html") : resolved;
    const actual = fs.realpathSync(file);
    if (!inside(entry.root, actual)) { response.writeHead(403).end(); return; }
    const stat = fs.statSync(actual);
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) { response.writeHead(404).end(); return; }
    const body = fs.readFileSync(actual);
    if (entry.revoked) { response.writeHead(410).end(); return; }
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(actual).toLowerCase()] ?? "application/octet-stream",
      "Content-Security-Policy": "default-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }).end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { response.writeHead(404).end(); return; }
    response.writeHead(500).end();
  }
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function ownedConnection(dynamic: DynamicPreview): Promise<net.Socket | null> {
  if (!dynamic.groupId || dynamic.exited || dynamic.ownershipLost || dynamic.controller.signal.aborted) return null;
  const socket = net.createConnection({ host: "127.0.0.1", port: dynamic.backendPort });
  const connected = await new Promise<boolean>((resolve) => {
    socket.once("connect", () => resolve(true));
    socket.once("error", () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
  if (!connected || !socket.localPort) { socket.destroy(); return null; }
  socket.setTimeout(0);
  const deadline = Date.now() + 5000;
  while (!socket.destroyed && !dynamic.exited && !dynamic.controller.signal.aborted) {
    try {
      const { stdout } = await execExternal("lsof", ["-nP", "-a", `-iTCP:${dynamic.backendPort}`, "-sTCP:LISTEN,ESTABLISHED", "-F", "pgn"], { timeoutMs: 2000, label: "preview:connection-owner" });
      const endpoint = `n127.0.0.1:${dynamic.backendPort}->127.0.0.1:${socket.localPort}`;
      const listener = `n127.0.0.1:${dynamic.backendPort}`;
      let groupId: number | undefined;
      let ownedConnection = false;
      let ownedListener = false;
      let otherListener = false;
      for (const field of stdout.split("\n")) {
        if (field.startsWith("p")) groupId = undefined;
        else if (field.startsWith("g")) groupId = Number(field.slice(1));
        else if (groupId === dynamic.groupId && field === endpoint) ownedConnection = true;
        else if ([listener, `n*:${dynamic.backendPort}`, `n[::]:${dynamic.backendPort}`].includes(field)) {
          if (groupId === dynamic.groupId) ownedListener = true;
          else otherListener = true;
        }
      }
      if (!ownedListener && otherListener) { dynamic.ownershipLost = true; break; }
      if (ownedListener && ownedConnection && !socket.destroyed && !dynamic.exited && !dynamic.controller.signal.aborted) return socket;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      break;
    }
  }
  socket.destroy();
  return null;
}

async function dynamicReady(dynamic: DynamicPreview, requestPath: string): Promise<boolean> {
  const socket = await ownedConnection(dynamic);
  if (!socket) return false;
  return new Promise<boolean>((resolve) => {
    const request = http.request({ method: "GET", path: requestPath, headers: { host: `127.0.0.1:${dynamic.backendPort}`, connection: "close" }, createConnection: () => socket }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(5000, () => request.destroy());
    request.once("error", () => resolve(false));
    request.end();
  });
}

async function proxyDynamic(entry: Running, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const dynamic = entry.dynamic;
  if (!dynamic || !dynamic.ready || entry.revoked) { response.writeHead(410).end(); return; }
  const socket = await ownedConnection(dynamic);
  if (!socket || entry.revoked || response.destroyed) { socket?.destroy(); if (!response.destroyed) response.writeHead(502).end(); return; }
  const upstream = http.request({
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: `127.0.0.1:${dynamic.backendPort}`, connection: "close" },
    createConnection: () => socket,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.once("error", () => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
  response.once("close", () => upstream.destroy());
  upstream.end();
}

function startDynamic(entry: Running, command: string): void {
  const dynamic = entry.dynamic!;
  const marker = `DEVHUB_PREVIEW_${randomUUID().replaceAll("-", "")}_`;
  let output = "";
  const script = `printf '${marker}%s\\n' "$$"\n${command.replaceAll("{port}", String(dynamic.backendPort))}`;
  void execExternal("/bin/sh", ["-c", script], {
    cwd: entry.cwd,
    env: { ...process.env, PORT: String(dynamic.backendPort), HOST: "127.0.0.1", HOSTNAME: "127.0.0.1", BROWSER: "none", ...(command.startsWith("./node_modules/.bin/expo ") ? { CI: "1", EXPO_NO_WEB_SETUP: "1" } : {}) },
    timeoutMs: 4 * 60 * 60 * 1000,
    label: "preview:dynamic",
    managedService: true,
    signal: dynamic.controller.signal,
    onStdout: (chunk) => {
      if (dynamic.groupId) return;
      output = (output + chunk.toString("utf8")).slice(0, 4096);
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      const line = output.slice(0, newline);
      const pid = line.startsWith(marker) ? Number(line.slice(marker.length)) : 0;
      if (Number.isSafeInteger(pid) && pid > 1) dynamic.groupId = pid;
    },
  }).then(() => { dynamic.exited = true; }, () => { dynamic.exited = true; });
}

function closeEntry(entry: Running): void {
  if (entry.leases === 0) entry.server.close();
}

export function stopPreview(taskId: string): void {
  generations.set(taskId, (generations.get(taskId) ?? 0) + 1);
  const entry = running.get(taskId);
  if (!entry) return;
  running.delete(taskId);
  if (isCurrent(entry)) {
    entry.revoked = true;
    entry.dynamic?.controller.abort();
    closeEntry(entry);
    return;
  }
  if (!entry.child?.pid) return;
  try {
    process.kill(-entry.child.pid, "SIGTERM");
  } catch {
    try { entry.child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

export async function ensurePreview(input: { taskId: string; repoName?: string; cwd?: string }): Promise<PreviewResult> {
  const found = previewConfig(input.repoName, input.cwd);
  if ("reason" in found) {
    stopPreview(input.taskId);
    return { state: "none", url: null, reason: found.reason.charAt(0).toUpperCase() + found.reason.slice(1) + "." };
  }
  const existing = running.get(input.taskId);
  if (existing && isCurrent(existing)) {
    if (existing.dynamic?.ownershipLost) {
      stopPreview(input.taskId);
      return { state: "none", url: null, reason: PREVIEW_OWNERSHIP_REFUSED };
    }
    if (existing.cwd !== input.cwd || existing.repoName !== input.repoName || existing.configFingerprint !== found.fingerprint || !existing.server.listening || existing.revoked || existing.dynamic?.exited) {
      stopPreview(input.taskId);
      return { state: "none", url: null, reason: "The managed preview changed or stopped. Retry QA." };
    }
    if (!existing.dynamic) return { state: "started", url: existing.url, reason: "The isolated static preview is running." };
    if (!existing.dynamic.ready) {
      const ready = await dynamicReady(existing.dynamic, found.config.path);
      if (existing.dynamic.ownershipLost) {
        stopPreview(input.taskId);
        return { state: "none", url: null, reason: PREVIEW_OWNERSHIP_REFUSED };
      }
      if (ready && running.get(input.taskId) === existing && !existing.revoked) existing.dynamic.ready = true;
      if (!existing.dynamic.ready && Date.now() - existing.startedAt >= found.config.readyTimeoutSec * 1000) {
        stopPreview(input.taskId);
        return { state: "none", url: null, reason: "The managed preview did not become ready; check its command, loopback binding and connection ownership." };
      }
    }
    return existing.dynamic.ready
      ? { state: "started", url: existing.url, reason: "The managed preview is running." }
      : { state: "starting", url: null, reason: "Waiting for the managed preview to become ready." };
  }
  if (existing) stopPreview(input.taskId);
  const isStatic = found.config.kind === "static";
  if (isStatic && (found.config.command || found.config.port || !found.config.directory)) {
    return { state: "none", url: null, reason: "Static previews require a directory and cannot specify a command or port." };
  }
  if (!isStatic && (found.config.port || !found.config.command?.includes("{port}"))) {
    return { state: "none", url: null, reason: "Command-based previews must use {port}; fixed ports cannot prove connection ownership." };
  }
  if (!isStatic && !found.config.trustCommand) {
    return { state: "none", url: null, reason: "Command previews require explicit trustCommand opt-in." };
  }
  if (!input.cwd) return { state: "none", url: null, reason: isStatic ? "No checkout to serve the static preview from." : "No checkout to start the preview from." };
  if (found.config.command?.startsWith("./node_modules/.bin/")) {
    const binary = found.config.command.split(" ")[0];
    if (!fs.existsSync(path.join(input.cwd, binary))) return { state: "none", url: null, reason: "The preview config is ready, but checkout dependencies are missing. Install them and retry QA." };
    if (found.config.kind === "expo-web") {
      const pkg = readProjectJson(input.cwd, "package.json");
      const missing = ["react-dom", "react-native-web"].filter(name => !hasDependency(pkg, name));
      if (missing.length) return { state: "none", url: null, reason: `The Expo preview config is ready, but web support needs ${missing.join(" and ")} in the checkout. Add web support and retry QA.` };
    }
  }
  let root: string | null;
  if (isStatic) root = staticRoot(input.cwd, found.config.directory!);
  else {
    try { root = fs.statSync(input.cwd).isDirectory() ? fs.realpathSync(input.cwd) : null; }
    catch { root = null; }
  }
  if (!root) return { state: "none", url: null, reason: isStatic ? "The static preview directory must exist inside the checkout." : "The managed preview checkout does not exist." };
  if (starting.has(input.taskId)) return { state: "starting", url: null, reason: "Starting the managed preview." };
  starting.add(input.taskId);
  const generation = generations.get(input.taskId) ?? 0;
  try {
    let dynamic: DynamicPreview | undefined;
    if (!isStatic) {
      try {
        if (process.platform === "win32") throw new Error("Process groups unavailable");
        await execExternal("lsof", ["-v"], { timeoutMs: 3000, label: "preview:ownership-check" });
        dynamic = { controller: new AbortController(), backendPort: await availablePort(), ready: false, exited: false };
      } catch {
        return { state: "none", url: null, reason: "Command previews require lsof and Unix process groups for connection ownership." };
      }
    }
    const entry: Running = {
      taskId: input.taskId, repoName: input.repoName, configFingerprint: found.fingerprint,
      cwd: input.cwd, root, url: "", server: http.createServer(), startedAt: Date.now(),
      leases: 0, revoked: false, ...(dynamic ? { dynamic } : {}),
    };
    entry.server.on("error", () => {
      if (running.get(input.taskId) === entry) stopPreview(input.taskId);
      else if (entry.server.listening) entry.server.close();
    });
    entry.server.on("request", (request, response) => {
      if (entry.revoked) { response.writeHead(410).end(); return; }
      if (request.headers.host !== new URL(entry.url || "http://127.0.0.1").host) { response.writeHead(403).end(); return; }
      if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
      if (entry.dynamic) {
        void proxyDynamic(entry, request, response).catch(() => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
        return;
      }
      try {
        const pathname = new URL(request.url ?? "/", entry.url).pathname;
        sendAsset(entry, pathname, response);
      } catch {
        response.writeHead(400).end();
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        entry.server.once("error", reject);
        entry.server.listen(0, "127.0.0.1", () => {
          entry.server.off("error", reject);
          resolve();
        });
      });
      if (generation !== (generations.get(input.taskId) ?? 0)) {
        entry.server.close();
        return { state: "none", url: null, reason: "The managed preview was stopped before it could start." };
      }
      const address = entry.server.address();
      if (!address || typeof address === "string") throw new Error("No preview port");
      entry.url = `http://127.0.0.1:${address.port}${found.config.path}`;
      running.set(input.taskId, entry);
      if (dynamic) {
        startDynamic(entry, found.config.command!);
        return { state: "starting", url: null, reason: "Starting the managed preview." };
      }
      return { state: "started", url: entry.url, reason: "The isolated static preview is running." };
    } catch {
      if (entry.server.listening) entry.server.close();
      return { state: "none", url: null, reason: "The managed preview could not bind a local listener." };
    }
  } finally {
    starting.delete(input.taskId);
  }
}

export function listPreviews(): Array<{ taskId: string; url: string; ready: boolean; startedAt: string }> {
  return [...running.values()].filter(isCurrent).map(entry => ({
    taskId: entry.taskId, url: entry.url, ready: entry.server.listening && !entry.revoked && (!entry.dynamic || (entry.dynamic.ready && !entry.dynamic.exited && !entry.dynamic.ownershipLost)), startedAt: new Date(entry.startedAt).toISOString(),
  }));
}

export function managedPreviewForTask(taskId: string): string | null {
  const entry = running.get(taskId);
  if (!entry || !isCurrent(entry) || entry.revoked || !entry.server.listening || (entry.dynamic && (!entry.dynamic.ready || entry.dynamic.exited || entry.dynamic.ownershipLost))) return null;
  const found = previewConfig(entry.repoName, entry.cwd);
  return "config" in found && found.fingerprint === entry.configFingerprint ? entry.url : null;
}

export function isManagedPreviewForTask(taskId: string, url: string): boolean {
  const managed = managedPreviewForTask(taskId);
  if (!managed) return false;
  try { return new URL(managed).href === new URL(url).href; }
  catch { return false; }
}

export async function verifyManagedPreviewForTask(taskId: string, url: string): Promise<boolean> {
  if (!isManagedPreviewForTask(taskId, url)) return false;
  const entry = running.get(taskId);
  if (!entry || !isCurrent(entry)) return false;
  if (!entry.dynamic) return true;
  const target = new URL(url);
  const ready = await dynamicReady(entry.dynamic, target.pathname + target.search);
  return ready && running.get(taskId) === entry && isManagedPreviewForTask(taskId, url);
}

export function leaseManagedPreviewForTask(taskId: string, url: string): (() => void) | null {
  if (!isManagedPreviewForTask(taskId, url)) return null;
  const entry = running.get(taskId);
  if (!entry || !isCurrent(entry)) return null;
  entry.leases++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.leases--;
    if (entry.revoked) closeEntry(entry);
  };
}
