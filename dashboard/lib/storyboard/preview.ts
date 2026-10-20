/**
 * Auto mode's preview for Jev when a task has no preview URL: start the repo's
 * dev server (or Expo web) in the task's checkout, but only when the repo opts
 * in with `upstarts/<repo>/preview.json`, e.g.
 *
 *   { "autoStart": true, "kind": "expo-web" }
 *   { "autoStart": true, "kind": "dev", "command": "pnpm dev --port {port}", "path": "/login" }
 *
 * Without it Jev is skipped with a "No preview" badge instead of blocking.
 * Starting never blocks a tick: the first call spawns the server and reports
 * "starting"; later calls report the URL once it answers, or why it didn't.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import { getUpstartsDir } from "@/lib/content/dirs";
import { sanitizeUpstartRepoName } from "@/lib/repos/upstart";

export const PREVIEW_CONFIG_NAME = "preview.json";
const DEFAULT_READY_SEC = 120;
const LOG_TAIL = 2000;

export const PreviewConfigSchema = z.object({
  autoStart: z.boolean(),
  kind: z.enum(["dev", "expo-web"]).default("dev"),
  /** Shell command run in the task's checkout. `{port}` is replaced; PORT is set too. */
  command: z.string().trim().min(1).max(500).optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  /** Where Jev starts, relative to the server root. */
  path: z.string().max(500).regex(/^\//).default("/"),
  readyTimeoutSec: z.number().int().min(10).max(600).default(DEFAULT_READY_SEC),
});
export type PreviewConfig = z.infer<typeof PreviewConfigSchema>;

export type PreviewResult =
  | { state: "starting"; url: null; reason: string }
  | { state: "started"; url: string; reason: string }
  | { state: "none"; url: null; reason: string };

export function previewConfigPath(repoName: string): string {
  return path.join(getUpstartsDir(), sanitizeUpstartRepoName(repoName), PREVIEW_CONFIG_NAME);
}

/** The repo's preview config, or why there isn't a usable one. */
export function readPreviewConfig(repoName: string | undefined): { config: PreviewConfig } | { reason: string } {
  if (!repoName) return { reason: "the task has no preview URL and no repo to start one from" };
  // Orchestration records carry owner/name; upstarts are keyed by the local repo name.
  const upstartName = repoName.match(/^[\w-]+\/([\w.-]+)$/)?.[1] ?? repoName;
  let file: string;
  try {
    file = previewConfigPath(upstartName);
  } catch {
    return { reason: `"${repoName}" isn't a repo name DevHub can look up` };
  }
  if (!fs.existsSync(file)) return { reason: `the task has no preview URL and ${repoName} has no upstarts/${upstartName}/${PREVIEW_CONFIG_NAME}` };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { reason: `upstarts/${upstartName}/${PREVIEW_CONFIG_NAME} isn't valid JSON` };
  }
  const parsed = PreviewConfigSchema.safeParse(raw);
  if (!parsed.success) return { reason: `upstarts/${upstartName}/${PREVIEW_CONFIG_NAME} is invalid: ${parsed.error.issues[0]?.message ?? "bad shape"}` };
  if (!parsed.data.autoStart) return { reason: `${repoName}'s preview config has autoStart off` };
  return { config: parsed.data };
}

export function previewCommand(config: PreviewConfig, port: number): string {
  const command = config.command ?? (config.kind === "expo-web" ? "npx expo start --web --port {port}" : "npm run dev");
  return command.replaceAll("{port}", String(port));
}

interface Running {
  taskId: string;
  cwd: string;
  url: string;
  child: ChildProcess | null;
  startedAt: number;
  timeoutMs: number;
  ready: boolean;
  failed?: string;
  log: string;
}

export interface PreviewDeps {
  spawn: (command: string, options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  freePort: () => Promise<number>;
  portInUse: (port: number) => Promise<boolean>;
  isUp: (url: string) => Promise<boolean>;
  now: () => number;
}

const realDeps: PreviewDeps = {
  // Detached so stopPreview can stop the whole process group (npm → next → workers).
  spawn: (command, { cwd, env }) => spawn("sh", ["-c", command], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }),
  freePort: () =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
      });
    }),
  portInUse: (port) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    }),
  isUp: async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
      return response.status < 500;
    } catch {
      return false;
    }
  },
  now: () => Date.now(),
};

// Pinned to globalThis: instrumentation and API routes can load separate module instances.
const KEY = Symbol.for("devhub.storyboard.previews");
const running: Map<string, Running> = ((globalThis as Record<symbol, unknown>)[KEY] as Map<string, Running> | undefined) ?? new Map();
(globalThis as Record<symbol, unknown>)[KEY] = running;
const starting = new Set<string>();

function killGroup(child: ChildProcess | null): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => { for (const entry of running.values()) killGroup(entry.child); });
}

function tail(log: string): string {
  const lines = log.trim().split("\n").slice(-3).join(" ⏎ ");
  return lines ? ` Last output: ${lines.slice(-300)}` : "";
}

/**
 * The preview for a task: started (with the URL), still starting, or none with
 * the reason. Safe to call every tick; at most one server per task.
 */
export async function ensurePreview(input: { taskId: string; repoName?: string; cwd?: string }, deps: PreviewDeps = realDeps): Promise<PreviewResult> {
  const existing = running.get(input.taskId);
  if (existing && existing.cwd === input.cwd) return check(existing, deps);
  if (existing) stopPreview(input.taskId);

  const found = readPreviewConfig(input.repoName);
  if ("reason" in found) return { state: "none", url: null, reason: capitalise(found.reason) + "." };
  if (!input.cwd || !fs.existsSync(input.cwd)) return { state: "none", url: null, reason: "No checkout to start the preview from." };
  if (starting.has(input.taskId)) return { state: "starting", url: null, reason: "Starting the preview." };
  starting.add(input.taskId);
  try {
    const { config } = found;
    if (config.port && (await deps.portInUse(config.port))) {
      return { state: "none", url: null, reason: `Port ${config.port} from ${input.repoName}'s preview config is already in use.` };
    }
    const port = config.port ?? (await deps.freePort());
    const url = `http://localhost:${port}${config.path}`;
    const command = previewCommand(config, port);
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), BROWSER: "none", ...(config.kind === "expo-web" ? { CI: "1", EXPO_NO_TELEMETRY: "1" } : {}) };
    const entry: Running = { taskId: input.taskId, cwd: input.cwd, url, child: null, startedAt: deps.now(), timeoutMs: config.readyTimeoutSec * 1000, ready: false, log: "" };
    try {
      const child = deps.spawn(command, { cwd: input.cwd, env });
      entry.child = child;
      const append = (chunk: Buffer | string) => { entry.log = (entry.log + chunk.toString()).slice(-LOG_TAIL); };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", (error) => { entry.failed = `The preview command failed to start: ${error.message}.`; });
      child.once("exit", (code, signal) => {
        if (!entry.failed) entry.failed = `The preview command exited (${signal ?? `code ${code}`}).${tail(entry.log)}`;
        entry.child = null;
      });
    } catch (error) {
      return { state: "none", url: null, reason: `The preview command failed to start: ${error instanceof Error ? error.message : String(error)}.` };
    }
    running.set(input.taskId, entry);
    installExitHook();
    return { state: "starting", url: null, reason: `Starting ${config.kind === "expo-web" ? "Expo web" : "the dev server"}: ${command}` };
  } finally {
    starting.delete(input.taskId);
  }
}

async function check(entry: Running, deps: PreviewDeps): Promise<PreviewResult> {
  if (entry.failed) {
    const reason = entry.failed;
    stopPreview(entry.taskId);
    return { state: "none", url: null, reason };
  }
  if (entry.ready || (await deps.isUp(entry.url))) {
    entry.ready = true;
    return { state: "started", url: entry.url, reason: `DevHub started the preview at ${entry.url}.` };
  }
  if (deps.now() - entry.startedAt > entry.timeoutMs) {
    const reason = `The preview didn't answer at ${entry.url} within ${Math.round(entry.timeoutMs / 1000)}s.${tail(entry.log)}`;
    stopPreview(entry.taskId);
    return { state: "none", url: null, reason };
  }
  return { state: "starting", url: null, reason: `Waiting for the preview at ${entry.url}.` };
}

/** Stop the task's preview server, if DevHub started one. */
export function stopPreview(taskId: string): void {
  const entry = running.get(taskId);
  if (!entry) return;
  running.delete(taskId);
  killGroup(entry.child);
}

/** Running previews, for the status endpoint. */
export function listPreviews(): Array<{ taskId: string; url: string; ready: boolean; startedAt: string }> {
  return [...running.values()].map((entry) => ({ taskId: entry.taskId, url: entry.url, ready: entry.ready, startedAt: new Date(entry.startedAt).toISOString() }));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
