import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { defaultAppDataDir, getResourceRoot } from "@/lib/desktop/runtime-paths";
import { execExternal } from "@/lib/exec-external";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { editorWorkspace } from "./workspace";
import { activateEditorVersion, readEditorVersion } from "./versions";

export const EDITOR_VERSION = "4.141.0";
const DIGESTS: Record<string, string> = {
  "macos-arm64": "ab45ad960725bdcdfb92998ef54feb2f479079224315ce44a4f49c54093453c9",
  "macos-amd64": "b133e002c2a1a4f22b2ec42c5f233147f342b592e2eadcacc51703a86f447f77",
  "linux-arm64": "e5cc78da1d631c6cf6162f9b18eeaa8ee9d3239e1a88bb99d0602cdc5fa1852d",
  "linux-amd64": "65bcd20b524d03eb1b5adb7f360244599ef0e5b74089a46a982d32c074b97a29",
};
export function editorDataDir() { return path.join(defaultAppDataDir(), "editor"); }
function platformKey() { return (process.platform === "darwin" ? "macos" : process.platform) + "-" + (process.arch === "x64" ? "amd64" : process.arch); }
function versionDir(version = readEditorVersion(editorDataDir(), EDITOR_VERSION).active) { return path.join(editorDataDir(), "versions", version); }
function binary(version?: string) { return path.join(versionDir(version), "bin", "code-server"); }
interface Session { ready?: boolean; workspaceId: string; origin: string; password: string; controller: AbortController; done: Promise<void>; error?: string }
interface Runtime { session?: Session; installing: boolean }
const host = globalThis as typeof globalThis & { devhubEditorRuntime?: Runtime };
const state = host.devhubEditorRuntime ??= { installing: false };
export function editorStatus() {
  const versions = readEditorVersion(editorDataDir(), EDITOR_VERSION);
  return { version: versions.active, availableVersion: EDITOR_VERSION, canRollback: Boolean(versions.previous && fs.existsSync(binary(versions.previous))), installed: fs.existsSync(binary()), supported: Boolean(DIGESTS[platformKey()]), installing: state.installing,
    session: state.session ? { ready: Boolean(state.session.ready), workspaceId: state.session.workspaceId, origin: state.session.origin, error: state.session.error } : null };
}
export async function installEditor() {
  return withPluginMutationLock(path.join(editorDataDir(), ".session-lock"), installEditorVersion);
}
async function installEditorVersion() {
  const platform = platformKey();
  const digest = DIGESTS[platform];
  if (!digest) throw new Error("Use DevHub's Linux service inside WSL for this editor.");
  return withPluginMutationLock(path.join(editorDataDir(), ".install-lock"), async () => {
    if (state.session) throw new Error("Stop the editor before installing an update.");
    if (fs.existsSync(binary(EDITOR_VERSION))) { activateEditorVersion(editorDataDir(), EDITOR_VERSION, EDITOR_VERSION); return editorStatus(); }
    state.installing = true;
    const staging = path.join(editorDataDir(), "install-" + randomUUID());
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    const archive = path.join(staging, "download.tar.gz");
    try {
      const name = "code-server-" + EDITOR_VERSION + "-" + platform;
      const response = await fetch("https://github.com/coder/code-server/releases/download/v" + EDITOR_VERSION + "/" + name + ".tar.gz", { signal: AbortSignal.timeout(600_000) });
      if (!response.ok || !response.body) throw new Error("Editor download failed. Try again.");
      const hash = createHash("sha256");
      const fd = fs.openSync(archive, "wx", 0o600);
      let bytes = 0;
      try {
        const reader = response.body.getReader();
        for (;;) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          bytes += chunk.byteLength;
          if (bytes > 300 * 1024 * 1024) throw new Error("Editor download exceeded its size limit.");
          hash.update(chunk); fs.writeSync(fd, chunk);
        }
      } finally { fs.closeSync(fd); }
      if (hash.digest("hex") !== digest) throw new Error("Editor checksum did not match the pinned release.");
      await execExternal("tar", ["-xzf", archive, "-C", staging], { timeoutMs: 120_000, label: "editor:extract" });
      const extracted = path.join(staging, name);
      const version = await execExternal(path.join(extracted, "bin/code-server"), ["--version"], { timeoutMs: 30_000, label: "editor:version" });
      if (!version.stdout.trim().split(/\s+/).includes(EDITOR_VERSION)) throw new Error("Unexpected editor version: " + version.stdout.slice(0, 120));
      fs.mkdirSync(path.dirname(versionDir()), { recursive: true, mode: 0o700 });
      fs.renameSync(extracted, versionDir(EDITOR_VERSION));
      activateEditorVersion(editorDataDir(), EDITOR_VERSION, EDITOR_VERSION);
      state.installing = false;
      return editorStatus();
    } finally { state.installing = false; fs.rmSync(staging, { recursive: true, force: true }); }
  });
}
async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Could not allocate editor port.")); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
export async function startEditor(workspaceId: string) {
  if (state.session) {
    if (state.session.workspaceId !== workspaceId) throw new Error("Save your files and stop the current editor before opening another workspace.");
    if (state.session.error) throw new Error(state.session.error);
    if (!state.session.ready) throw new Error("The editor is still starting.");
    return { ...editorStatus(), password: state.session.password };
  }
  return new Promise<ReturnType<typeof editorStatus> & { password: string }>((resolve, reject) => {
    void withPluginMutationLock(path.join(editorDataDir(), ".session-lock"), async () => {
      const result = await launchEditor(workspaceId);
      resolve(result);
      // The cross-process lease lasts as long as the owned process, including startup.
      await state.session?.done;
    }).catch(reject);
  });
}
async function launchEditor(workspaceId: string) {
    if (!fs.existsSync(binary())) throw new Error("Install the optional editor first.");
    const cwd = editorWorkspace(workspaceId);
    const port = await availablePort();
    const data = path.join(editorDataDir(), "data");
    const extensions = path.join(editorDataDir(), "extensions");
    fs.mkdirSync(data, { recursive: true, mode: 0o700 });
    fs.mkdirSync(extensions, { recursive: true, mode: 0o700 });
    const extensionSource = path.join(getResourceRoot(), "extensions/devhub-selection");
    if (!fs.existsSync(path.join(extensionSource, "dist/extension.js"))) throw new Error("The selection add-on is missing. Build extensions/devhub-selection before starting the editor.");
    fs.cpSync(extensionSource, path.join(extensions, "devhub.selection-0.1.0"), { recursive: true, filter: (source) => !source.includes("node_modules") && !source.endsWith(".vsix") });
    const password = randomBytes(24).toString("base64url");
    const config = path.join(editorDataDir(), "config.yaml");
    fs.writeFileSync(config, "auth: password\nbind-addr: 127.0.0.1:" + port + "\npassword: " + password + "\ncert: false\n", { mode: 0o600 });
    fs.chmodSync(config, 0o600);
    const settingsDir = path.join(data, "User");
    fs.mkdirSync(settingsDir, { recursive: true });
    const settings = path.join(settingsDir, "settings.json");
    if (!fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({ "telemetry.telemetryLevel": "off", "extensions.allowed": { "devhub.selection": ["0.1.0"] }, "extensions.autoUpdate": false, "extensions.autoCheckUpdates": false, "files.hotExit": "onExit", "workbench.startupEditor": "none", "chat.disableAIFeatures": true }), { mode: 0o600 });
    const controller = new AbortController();
    const session: Session = { workspaceId, origin: "http://127.0.0.1:" + port, password, controller, done: Promise.resolve() };
    state.session = session;
    const stopOnExit = () => controller.abort();
    process.once("exit", stopOnExit);
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    for (const key of ["PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TMPDIR", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]) if (process.env[key]) env[key] = process.env[key];
    session.done = execExternal(process.execPath, [path.join(getResourceRoot(), "scripts/owned-runtime.mjs"), String(process.pid), binary(), "--config", config, "--user-data-dir", data, "--extensions-dir", extensions, "--disable-telemetry", "--disable-update-check", "--disable-proxy", "--cookie-suffix", "devhub-editor", cwd], {
      cwd, env, signal: controller.signal, timeoutMs: 2_000_000_000, maxBuffer: 16 * 1024 * 1024, label: "editor:session", managedService: true,
    }).then(() => { session.error = "Editor stopped. Your workspace files are unchanged."; }).catch(() => { session.error = "Editor stopped or failed to start. Save any visible buffers and restart it."; }).finally(() => { process.removeListener("exit", stopOnExit); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (session.error) throw new Error(session.error);
      try {
        const response = await fetch(session.origin + "/healthz", { signal: AbortSignal.timeout(500), redirect: "error" });
        if (response.ok) { session.ready = true; return { ...editorStatus(), password }; }
      } catch { /* Startup is asynchronous; bounded polling tolerates the bind delay. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    controller.abort(); await session.done; state.session = undefined;
    throw new Error("Editor did not become ready. Try starting it again.");
}
export async function stopEditor() {
  const session = state.session;
  if (!session) return;
  session.controller.abort(); await session.done;
  if (state.session === session) state.session = undefined;
}
export async function rollbackEditor() {
  if (state.session) throw new Error("Save your files and stop the editor first.");
  return withPluginMutationLock(path.join(editorDataDir(), ".session-lock"), async () => {
    const { previous } = readEditorVersion(editorDataDir(), EDITOR_VERSION);
    if (!previous) throw new Error("No previous editor version is installed.");
    activateEditorVersion(editorDataDir(), previous, EDITOR_VERSION);
    return editorStatus();
  });
}
export async function uninstallEditor() {
  if (state.session) throw new Error("Save your files and stop the editor first.");
  return withPluginMutationLock(path.join(editorDataDir(), ".session-lock"), async () => {
    return withPluginMutationLock(path.join(editorDataDir(), ".install-lock"), async () => {
      fs.rmSync(path.join(editorDataDir(), "versions"), { recursive: true, force: true });
      fs.rmSync(path.join(editorDataDir(), "active.json"), { force: true });
      // Keep the editor's recovery data, extensions and all workspace files.
      return editorStatus();
    });
  });
}
