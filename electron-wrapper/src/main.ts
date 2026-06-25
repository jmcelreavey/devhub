import { app, BrowserWindow, dialog, Menu, nativeImage, screen, session, shell, type MenuItemConstructorOptions } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { LaunchScript } from "./shared";
import { EXTRA_PATH_SEGMENTS, appendPath, nvmNodeBinDirs, prependPath } from "./path-fallbacks";
import { loadSettings, saveSettings } from "./settings";

/**
 * Resolve npm — honoring the project's `.nvmrc` via nvm — and put that node's
 * bin dir first on PATH for everything we spawn (dev + production).
 *
 * Why: nvm initializes in the user's shell rc (interactive), so a plain login
 * shell or a GUI launch doesn't see it and falls back to a system/Homebrew node.
 * That means the wrong node version AND a PATH missing the nvm bin dir — which
 * is where globally-installed CLIs like `openchamber` live. We source `nvm.sh`
 * explicitly (works non-interactively) and run `nvm use` from the dashboard dir
 * so it reads `.nvmrc`, then prepend the resolved node's bin. After this,
 * `node`, `npm`, and nvm-global tools all resolve from the pinned version.
 */
function resolveNpm(): string {
  const shellBin = process.env.SHELL || "/bin/zsh";
  let dashboardDir = "";
  try {
    dashboardDir = path.join(projectRoot(), "dashboard");
  } catch { /* project root not resolvable yet — fall back to nvm default */ }

  // Single-quoted for the outer /bin/sh that execSync uses; no single quotes
  // inside. `nvm use` (no arg) reads .nvmrc from cwd, set below.
  const script =
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; ' +
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; ' +
    "nvm use >/dev/null 2>&1; command -v npm";
  try {
    const out = require("node:child_process")
      .execSync(`${shellBin} -lc '${script}'`, {
        encoding: "utf8",
        timeout: 8000,
        ...(dashboardDir && fs.existsSync(dashboardDir) ? { cwd: dashboardDir } : {}),
      })
      .trim();
    const resolved = out.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean).pop();
    if (resolved && fs.existsSync(resolved)) {
      prependPath(path.dirname(resolved));
      return resolved;
    }
  } catch { /* fall through */ }

  // No nvm — search nvm bin dirs (honoring .nvmrc major) then common locations.
  for (const dir of [...nvmNodeBinDirsForProject(dashboardDir), ...EXTRA_PATH_SEGMENTS]) {
    const candidate = path.join(dir, "npm");
    if (fs.existsSync(candidate)) {
      prependPath(dir);
      return candidate;
    }
  }
  return "npm";
}

/** nvm node bin dirs, preferring the major pinned in `.nvmrc` when present. */
function nvmNodeBinDirsForProject(dashboardDir: string): string[] {
  const dirs = nvmNodeBinDirs();
  let want = "";
  for (const f of [path.join(dashboardDir, "..", ".nvmrc"), path.join(dashboardDir, ".nvmrc")]) {
    try {
      const v = fs.readFileSync(f, "utf8").trim().replace(/^v/, "");
      if (v) { want = v.split(".")[0]; break; }
    } catch { /* no .nvmrc here */ }
  }
  if (!want) return dirs;
  const matches = dirs.filter((d) => {
    const m = d.match(/\/v(\d+)\./);
    return m && m[1] === want;
  });
  return [...matches, ...dirs];
}

/**
 * The dashboard's `preinstall` gate requires `safe-chain` on PATH. A GUI launch,
 * or a default node version that differs from where safe-chain was installed
 * (e.g. installed under one nvm version while the default is another), can leave
 * it unreachable. Search the nvm bins + common locations and append wherever it
 * lives — appended, not prepended, so the resolved npm/node stay in front.
 */
function ensureSafeChainOnPath(): void {
  const onPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, "safe-chain")));
  if (onPath) return;

  for (const dir of [...nvmNodeBinDirs(), ...EXTRA_PATH_SEGMENTS]) {
    if (fs.existsSync(path.join(dir, "safe-chain"))) {
      appendPath(dir);
      console.log(`[devhub] found safe-chain in ${dir}; added to PATH`);
      return;
    }
  }
  console.warn("[devhub] safe-chain not found on PATH or in nvm bins; dashboard install may fail its preinstall gate.");
}

const npmBin = resolveNpm();
ensureSafeChainOnPath();
console.log(`[devhub] resolved npm: ${npmBin}`);

const DASHBOARD_PORT = 1337;
const CHAMBER_PORT = 1336;
const OPENCODE_PORT = 1338;
const TERMINAL_PORT = 1339;
const PROCESS_EXIT_WAIT_MS = 1_500;
const PORT_POLL_INTERVAL_MS = 500;
const PORT_POLL_MAX_ATTEMPTS = 20;
const LOG_BUFFER_MAX_LINES = 1_000;

const NPM_LIFECYCLE_KEYS = [
  "INIT_CWD",
  "npm_command",
  "npm_execpath",
  "npm_lifecycle_event",
  "npm_lifecycle_script",
  "npm_node_execpath",
  "npm_package_json",
  "npm_package_name",
  "npm_package_version",
];

function cleanNpmEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("npm_config_") || key.startsWith("npm_package_")) {
      delete clean[key];
    }
  }
  for (const key of NPM_LIFECYCLE_KEYS) {
    delete clean[key];
  }
  return clean;
}

let appWindow: BrowserWindow | null = null;
let activeProcess: ChildProcessWithoutNullStreams | null = null;
let chamberProcess: ChildProcessWithoutNullStreams | null = null;
let activeScript: LaunchScript | null = null;
let lastScript: LaunchScript = "dev";
let cleanupPromise: Promise<void> | null = null;
let cleanupComplete = false;
let quittingAfterCleanup = false;
let updateCheckInProgress = false;
let manualUpdateCheck = false;

let resolvedProjectRoot: string | null = null;

function dashboardEnvValue(key: string): string | undefined {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) return fromProcess;
  try {
    const envLocal = fs.readFileSync(path.join(projectRoot(), "dashboard", ".env.local"), "utf8");
    const line = envLocal.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

function isCgnat(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function detectLanIp(): string | null {
  const virtualIface = /^(docker|br-|veth|virbr|ll\d|bridge|tap|zt|wg)/i;
  const physicalPref = ["en0", "en1", "en2", "eth0", "enp", "wlan", "Wi-Fi"];
  const candidates: { iface: string; ip: string }[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!addrs || virtualIface.test(name)) continue;
    for (const a of addrs) {
      if (a.family !== "IPv4" || a.internal || isCgnat(a.address)) continue;
      candidates.push({ iface: name, ip: a.address });
    }
  }
  candidates.sort((x, y) => {
    const rank = (iface: string): number => {
      const i = physicalPref.findIndex((p) => iface.startsWith(p));
      return i === -1 ? 99 : i;
    };
    return rank(x.iface) - rank(y.iface);
  });
  return candidates[0]?.ip ?? null;
}

function dashboardHost(): string {
  const raw = dashboardEnvValue("DEVHUB_BIND_HOST") || "0.0.0.0";
  const host = raw.trim().toLowerCase();
  if (host === "auto" || host === "lan") return detectLanIp() ?? "127.0.0.1";
  if (host === "0.0.0.0" || host === "::") return "localhost";
  return raw.trim() || "localhost";
}

function dashboardUrl(): string {
  return `http://${dashboardHost()}:${DASHBOARD_PORT}`;
}

function openChamberEnv(): NodeJS.ProcessEnv {
  const env = cleanNpmEnv();
  const userOpencode = path.join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (!process.env.DEVHUB_OPENCODE_BINARY && fs.existsSync(userOpencode)) {
    env.OPENCODE_BINARY = userOpencode;
  } else if (process.env.DEVHUB_OPENCODE_BINARY) {
    env.OPENCODE_BINARY = process.env.DEVHUB_OPENCODE_BINARY;
  }
  const opencodePort = Number.parseInt(process.env.OPENCODE_PORT ?? String(OPENCODE_PORT), 10);
  env.OPENCODE_PORT = String(opencodePort);
  env.OPENCODE_SKIP_START = "true";
  delete env.OPENCODE_HOST;
  return env;
}

function resolveOpenChamberCommand(): { cmd: string; argsPrefix: string[] } | null {
  // OpenChamber is developer-managed: DevHub no longer vendors @openchamber/web.
  // A GUI launch inherits a minimal PATH, so look beyond it — common bin dirs,
  // nvm node bins, and finally the user's login shell. Returns null when nothing
  // is found so the caller skips Chamber entirely.
  const configured = process.env.OPENCHAMBER_BIN?.trim();
  if (configured && fs.existsSync(configured)) return { cmd: configured, argsPrefix: [] };

  const which = process.platform === "win32" ? "where" : "which";
  const onPath = spawnSync(which, ["openchamber"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (onPath.status === 0) {
    const first = onPath.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return { cmd: first, argsPrefix: [] };
  }

  for (const dir of [...nvmNodeBinDirs(), ...EXTRA_PATH_SEGMENTS]) {
    const candidate = path.join(dir, "openchamber");
    if (fs.existsSync(candidate)) return { cmd: candidate, argsPrefix: [] };
  }

  const shellBin = process.env.SHELL || "/bin/sh";
  try {
    const resolved = spawnSync(shellBin, ["-lic", "command -v openchamber"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    if (resolved.status === 0) {
      const last = resolved.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
      if (last && fs.existsSync(last)) return { cmd: last, argsPrefix: [] };
    }
  } catch { /* fall through */ }

  return null;
}

function resolveOpenCodeBinary(): string {
  const configured = process.env.DEVHUB_OPENCODE_BINARY?.trim();
  if (configured) return configured;
  const userBin = path.join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (fs.existsSync(userBin)) return userBin;
  return "opencode";
}

function openCodeEnv(): NodeJS.ProcessEnv {
  return cleanNpmEnv();
}

function projectRoot(): string {
  if (resolvedProjectRoot) return resolvedProjectRoot;
  if (!app.isPackaged) {
    resolvedProjectRoot = path.resolve(app.getAppPath(), "..");
    return resolvedProjectRoot;
  }
  const stored = path.join(app.getPath("userData"), "repo-path.txt");
  if (fs.existsSync(stored)) {
    const repoPath = fs.readFileSync(stored, "utf8").trim();
    if (fs.existsSync(path.join(repoPath, "package.json"))) {
      resolvedProjectRoot = repoPath;
      return repoPath;
    }
  }
  return path.join(process.resourcesPath, "devhub");
}

async function ensureProjectRoot(): Promise<void> {
  if (!app.isPackaged || resolvedProjectRoot) return;
  const stored = path.join(app.getPath("userData"), "repo-path.txt");
  if (fs.existsSync(stored)) {
    const repoPath = fs.readFileSync(stored, "utf8").trim();
    if (fs.existsSync(path.join(repoPath, "package.json"))) {
      resolvedProjectRoot = repoPath;
      return;
    }
  }
  createLauncherWindow();
  const result = await dialog.showOpenDialog(appWindow!, {
    title: "Where is your DevHub repo?",
    properties: ["openDirectory"],
    buttonLabel: "Select Repo Folder",
  });
  if (result.canceled || !result.filePaths[0]) {
    app.quit();
    return;
  }
  const selected = result.filePaths[0];
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(stored, selected, "utf8");
  resolvedProjectRoot = selected;
}

function dashboardNodeModules(): string {
  return path.join(projectRoot(), "dashboard", "node_modules");
}

/**
 * App icon, resolvable in both dev and packaged layouts. Undefined if missing.
 * A branding plugin can whitelabel it: `plugin-electron-icon.png` (written by the branding
 * materialiser) wins over the default DevHub icon when present.
 */
function appIconPath(): string | undefined {
  const publicDir = path.join(projectRoot(), "dashboard", "public");
  const branded = path.join(publicDir, "plugin-electron-icon.png");
  if (fs.existsSync(branded)) return branded;
  const icon = path.join(publicDir, "icon-512.png");
  return fs.existsSync(icon) ? icon : undefined;
}

/** The stock DevHub icon (never the whitelabel) — used when the user picks "DevHub default". */
function devhubIconPath(): string | undefined {
  const icon = path.join(projectRoot(), "dashboard", "public", "icon-512.png");
  return fs.existsSync(icon) ? icon : undefined;
}

/**
 * Best-effort: reflect the user's in-app logo choice on the *running* dock/window icon.
 * Reads the dashboard's stored logo key straight from the page (no IPC bridge needed):
 * when the user explicitly picks the stock DevHub mark ("__devhub__") we show the default
 * icon, otherwise the active (whitelabel) app icon. The installed Finder icon is baked at
 * build time and is unaffected. Never throws.
 */
async function syncDockIconFromRenderer(win: BrowserWindow): Promise<void> {
  try {
    const choice = (await win.webContents.executeJavaScript(
      "(()=>{try{return localStorage.getItem('devhub-logo-icon')}catch(e){return null}})()",
      true,
    )) as string | null;
    const iconFile = choice === "__devhub__" ? devhubIconPath() : appIconPath();
    if (!iconFile) return;
    const img = nativeImage.createFromPath(iconFile);
    if (img.isEmpty()) return;
    if (process.platform === "darwin" && app.dock) app.dock.setIcon(img);
    win.setIcon(img);
  } catch {
    // best-effort only — never block the app over a cosmetic icon
  }
}

function canConnect(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForDashboard(timeoutMs = 60_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(DASHBOARD_PORT, dashboardHost())) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Restore saved bounds only when they still land on a connected display. */
function restorableBounds(): { x: number; y: number; width: number; height: number } | null {
  const saved = loadSettings().windowBounds;
  if (!saved || saved.width < 400 || saved.height < 300) return null;
  const display = screen.getDisplayMatching(saved);
  const wa = display.workArea;
  const intersects =
    saved.x < wa.x + wa.width &&
    saved.x + saved.width > wa.x &&
    saved.y < wa.y + wa.height &&
    saved.y + saved.height > wa.y;
  return intersects ? saved : null;
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist of window bounds + maximized state. */
function persistWindowState(window: BrowserWindow): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (window.isDestroyed()) return;
    const settings = loadSettings();
    settings.windowMaximized = window.isMaximized();
    if (!window.isMaximized() && !window.isFullScreen()) {
      settings.windowBounds = window.getBounds();
    }
    saveSettings(settings);
  }, 400);
}

function createLauncherWindow(): BrowserWindow {
  if (appWindow) {
    appWindow.focus();
    return appWindow;
  }

  const savedBounds = restorableBounds();
  appWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1280,
    height: savedBounds?.height ?? 820,
    x: savedBounds?.x,
    y: savedBounds?.y,
    title: "DevHub Launcher",
    icon: appIconPath(),
    // Matches the dashboard's darkest background — no white flash while
    // the web app loads.
    backgroundColor: "#0d1012",
    show: false,
  });
  if (loadSettings().windowMaximized) appWindow.maximize();
  appWindow.once("ready-to-show", () => appWindow?.show());

  appWindow.on("resize", () => appWindow && persistWindowState(appWindow));
  appWindow.on("move", () => appWindow && persistWindowState(appWindow));
  appWindow.on("maximize", () => appWindow && persistWindowState(appWindow));
  appWindow.on("unmaximize", () => appWindow && persistWindowState(appWindow));

  appWindow.on("close", (event) => {
    if (cleanupComplete) return;
    event.preventDefault();
    void quitAfterCleanup();
  });

  appWindow.on("closed", () => {
    appWindow = null;
  });

  appWindow.webContents.on("context-menu", (_event, params) => {
    Menu.buildFromTemplate([
      { role: "undo", enabled: params.editFlags.canUndo },
      { role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    ]).popup({ window: appWindow ?? undefined });
  });

  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Reflect the user's in-app logo choice (DevHub default vs whitelabel) on the dock icon.
  appWindow.webContents.on("did-finish-load", () => {
    if (appWindow) void syncDockIconFromRenderer(appWindow);
  });
  appWindow.on("focus", () => {
    if (appWindow) void syncDockIconFromRenderer(appWindow);
  });

  appWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  return appWindow;
}

function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function showLogView(): void {
  const window = createLauncherWindow();

  const html = `<!doctype html><html><head><title>DevHub Logs</title><style>
    body{margin:0;background:#090d13;color:#e6edf3;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
    header{padding:12px 16px;background:#151b23;border-bottom:1px solid #30363d;font:600 14px system-ui;display:flex;justify-content:space-between;align-items:center}
    #status{font:400 12px system-ui;color:#7d8590}
    #back-btn{background:#238636;color:#fff;border:1px solid #2ea043;border-radius:6px;padding:4px 12px;font:500 12px system-ui;cursor:pointer;white-space:nowrap}
    #back-btn:hover{background:#2ea043}
    pre{box-sizing:border-box;height:calc(100vh - 45px);margin:0;overflow:auto;padding:16px;white-space:pre-wrap}
  </style></head><body><header><span>DevHub launcher logs <span id="status"></span></span><button id="back-btn" onclick="location.href='${dashboardUrl()}'">Back to DevHub</button></header><pre id="log">${logBuffer.map(escapeHtml).join("")}</pre></body></html>`;

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const logBuffer: string[] = [];

function appendLog(line: string): void {
  console.log(line.trimEnd());
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_MAX_LINES) logBuffer.shift();
  if (!appWindow) return;
  const escaped = JSON.stringify(line);
  void appWindow.webContents.executeJavaScript(`
    {
      const el = document.getElementById('log');
      if (el) {
        el.textContent += ${escaped};
        el.scrollTop = el.scrollHeight;
      }
    }
  `).catch(() => {});
}

function setStatus(text: string): void {
  if (!appWindow) return;
  const escaped = JSON.stringify(text);
  void appWindow.webContents.executeJavaScript(`
    {
      const el = document.getElementById('status');
      if (el) el.textContent = ${escaped};
    }
  `);
}

function spawnNpm(args: readonly string[]): ChildProcessWithoutNullStreams {
  appendLog(`$ ${npmBin} ${args.join(" ")}\n`);
  const child = spawn(npmBin, [...args], {
    cwd: projectRoot(),
    env: cleanNpmEnv(),
    shell: true,
  });

  child.on("error", (err) => appendLog(`spawn error: ${err.message}\n`));
  child.stdout.on("data", (chunk: Buffer) => appendLog(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => appendLog(chunk.toString()));
  return child;
}

function spawnDashboardNpm(args: readonly string[]): ChildProcessWithoutNullStreams {
  appendLog(`dashboard $ ${npmBin} ${args.join(" ")}\n`);
  const child = spawn(npmBin, [...args], {
    cwd: path.join(projectRoot(), "dashboard"),
    env: cleanNpmEnv(),
    shell: true,
  });

  child.on("error", (err) => appendLog(`spawn error: ${err.message}\n`));
  child.stdout.on("data", (chunk: Buffer) => appendLog(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => appendLog(chunk.toString()));
  return child;
}

function runNpm(args: readonly string[]): Promise<void> {
  showLogView();
  return new Promise((resolve, reject) => {
    const child = spawnNpm(args);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function ensureDependencies(force = false): Promise<void> {
  if (!force && fs.existsSync(dashboardNodeModules())) {
    appendLog("dashboard/node_modules exists; skipping install.\n");
    return;
  }
  setStatus("Installing dependencies...");
  await runNpm(["install", "--prefix", "./dashboard", "--loglevel", "error"]);
  setStatus("");
}

/**
 * `npm run start` runs `next start`, which needs a production build. A successful
 * build writes `.next/BUILD_ID`; if it's missing, build first so production mode
 * doesn't die on "Could not find a production build".
 */
async function ensureProductionBuild(force = false): Promise<void> {
  const buildId = path.join(projectRoot(), "dashboard", ".next", "BUILD_ID");
  if (!force && fs.existsSync(buildId)) {
    appendLog("Production build found; skipping build.\n");
    return;
  }
  setStatus("Building for production...");
  appendLog("Running npm run build...\n");
  await runNpm(["run", "build"]);
  setStatus("");
}

async function reinstallDependenciesAndRestart(): Promise<void> {
  const scriptToRestart = activeScript ?? lastScript;
  showLogView();
  appendLog(`Reinstalling dependencies, then restarting npm run ${scriptToRestart}...\n`);
  await stopActiveProcessForRestart();
  await killPortListeners([DASHBOARD_PORT, CHAMBER_PORT, OPENCODE_PORT, TERMINAL_PORT]);
  await ensureDependencies(true);
  await startScript(scriptToRestart);
}

async function signalPortPids(port: number, signal: NodeJS.Signals): Promise<string[]> {
  return new Promise((resolve) => {
    const lsof = spawn("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"]);
    let output = "";
    lsof.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    lsof.on("close", () => {
      const pids = output.split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), signal);
          appendLog(`Sent ${signal} to PID ${pid} on port ${port}.\n`);
        } catch {
          // process already gone
        }
      }
      resolve(pids);
    });
    lsof.on("error", () => resolve([]));
  });
}

function configureAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.logger = console;
  autoUpdater.autoInstallOnAppQuit = true;

  appendLog("[updater] Auto-updater configured. Packaged: " + app.isPackaged + "\n");
  appendLog("[updater] Repo: jmcelreavey/devhub, Current version: " + app.getVersion() + "\n");
  appendLog("[updater] Note: Code signature validation errors are expected with ad-hoc signing.\n");
  appendLog("[updater] For production, add Apple Developer certificate (CSC_LINK/CSC_KEY_PASSWORD).\n");

  autoUpdater.on("checking-for-update", () => {
    updateCheckInProgress = true;
    appendLog("Checking for DevHub launcher updates...\n");
  });

  autoUpdater.on("update-available", async (info) => {
    updateCheckInProgress = false;
    const response = await showLauncherMessageBox({
      type: "info",
      title: "DevHub Update Available",
      message: `DevHub ${info.version} is available.`,
      detail: "Download it now? The app will ask before installing after the download completes.",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response.response === 0) {
      appendLog(`Downloading DevHub ${info.version}...\n`);
      await autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on("update-not-available", async () => {
    updateCheckInProgress = false;
    if (!manualUpdateCheck) return;
    await showLauncherMessageBox({
      type: "info",
      title: "DevHub Is Up To Date",
      message: "No DevHub launcher update is available.",
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const response = await showLauncherMessageBox({
      type: "info",
      title: "DevHub Update Ready",
      message: `DevHub ${info.version} has downloaded.`,
      detail: "Restart DevHub now to install it? (Dev mode: will bypass code signature check)",
      buttons: ["Restart and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response.response === 0) {
      appendLog("[updater] Attempting dev-mode install from downloaded update...\n");
      const installed = await installUpdateFromCache();
      if (installed) {
        appendLog("[updater] Dev-mode install succeeded. Restarting...\n");
        cleanupComplete = true;
        app.relaunch();
        app.quit();
        return;
      }
      appendLog("[updater] Cache install failed, falling back to quitAndInstall...\n");
      cleanupComplete = true;
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", async (error) => {
    updateCheckInProgress = false;
    const errMsg = error instanceof Error ? error.message : String(error);
    appendLog(`Update check failed: ${errMsg}\n`);

    if (errMsg.includes("Code signature") || errMsg.includes("code signature")) {
      appendLog("[updater] Signature validation failed - attempting dev-mode install from cache.\n");
      const installed = await installUpdateFromCache();
      if (installed) {
        appendLog("[updater] Dev-mode install succeeded. Restarting...\n");
        cleanupComplete = true;
        app.relaunch();
        app.quit();
        return;
      }
      appendLog("[updater] Dev-mode install failed - offering manual options.\n");
      const response = await showLauncherMessageBox({
        type: "warning",
        title: "DevHub Update Downloaded (Dev Mode)",
        message: "Automatic dev-mode install failed. The update was downloaded but could not be installed automatically.",
        detail: "Open the GitHub release page to download and install manually.",
        buttons: ["Open Release Page", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response.response === 0) {
        void shell.openExternal("https://github.com/jmcelreavey/devhub/releases/latest");
      }
      return;
    }

    if (!manualUpdateCheck) return;
    await showLauncherMessageBox({
      type: "error",
      title: "DevHub Update Check Failed",
      message: errMsg,
    });
  });
}

async function installUpdateFromCache(): Promise<boolean> {
  const updater = autoUpdater as unknown as Record<string, unknown>;
  const helper = updater.downloadedUpdateHelper as Record<string, unknown> | undefined;
  let downloadedFile: string | undefined;

  try {
    downloadedFile = (helper?.file as string | undefined) || undefined;
  } catch { /* cast may fail */ }

  appendLog(`[updater] Downloaded update file from helper: ${downloadedFile ?? "(none)"}\n`);
  appendLog(`[updater] app.name = "${app.name}", app.getName() = "${app.getName()}"\n`);

  const candidateFiles: string[] = [];
  if (downloadedFile && fs.existsSync(downloadedFile)) {
    candidateFiles.push(downloadedFile);
  }

  const cacheBase = path.join(app.getPath("home"), "Library", "Caches");
  appendLog(`[updater] Scanning cache base: ${cacheBase}\n`);

  try {
    if (fs.existsSync(cacheBase)) {
      const walkAll = (d: string, depth: number = 0) => {
        if (depth > 4) return;
        try {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name === "com.apple") continue;
            const fullPath = path.join(d, entry.name);
            if (entry.isDirectory()) {
              walkAll(fullPath, depth + 1);
              continue;
            }
            if (entry.isFile() && (fullPath.endsWith(".zip") || fullPath.endsWith(".dmg"))) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size > 1_000_000 && Date.now() - stat.mtimeMs < 3600_000) {
                  candidateFiles.push(fullPath);
                  appendLog(`[updater] Found candidate: ${fullPath} (${Math.round(stat.size / 1024 / 1024)}MB)\n`);
                }
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
      };
      walkAll(cacheBase);
    }
  } catch (err) {
    appendLog(`[updater] Cache scan error: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  appendLog(`[updater] Total candidates: ${candidateFiles.length}\n`);

  for (const filePath of candidateFiles) {
    try {
      appendLog(`[updater] Extracting: ${filePath}...\n`);
      const installed = await extractAndInstall(filePath);
      if (installed) return true;
    } catch (err) {
      appendLog(`[updater] Failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  appendLog("[updater] No usable downloaded update found.\n");
  return false;
}

async function extractAndInstall(archivePath: string): Promise<boolean> {
  const extractDir = path.join(app.getPath("userData"), "update-extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  const ext = path.extname(archivePath).toLowerCase();

  if (ext === ".zip") {
    const { execFileSync } = await import("node:child_process");
    execFileSync("unzip", ["-o", archivePath, "-d", extractDir], { stdio: "ignore" });
  } else if (ext === ".dmg") {
    appendLog("[updater] DMG extraction not supported in dev mode.\n");
    return false;
  }

  const appNames = ["DevHub.app"];
  for (const appName of appNames) {
    const extractedApp = path.join(extractDir, appName);
    if (fs.existsSync(extractedApp)) {
      const installPath = "/Applications/DevHub.app";
      appendLog(`[updater] Installing ${extractedApp} → ${installPath}...\n`);
      fs.rmSync(installPath, { recursive: true, force: true });
      const { execFileSync } = await import("node:child_process");
      execFileSync("ditto", [extractedApp, installPath], { stdio: "pipe" });
      fs.rmSync(extractDir, { recursive: true, force: true });
      appendLog("[updater] Install complete.\n");
      return true;
    }
  }

  appendLog(`[updater] No ${appNames[0]} found in extracted archive.\n`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  return false;
}

async function checkForUpdates(manual = false): Promise<void> {
  manualUpdateCheck = manual;
  if (!app.isPackaged) {
    appendLog("[updater] Skipped: running in development mode.\n");
    if (manual) {
      await showLauncherMessageBox({
        type: "info",
        title: "Updates Disabled In Development",
        message: "Auto-updates only run in the packaged DevHub app.",
      });
    }
    return;
  }
  if (updateCheckInProgress) {
    appendLog("[updater] Skipped: update check already in progress.\n");
    return;
  }
  appendLog(`[updater] Checking for updates (manual=${manual})...\n`);
  try {
    const result = await autoUpdater.checkForUpdates();
    appendLog(`[updater] Check result: ${JSON.stringify({ version: result?.updateInfo?.version, hasUpdate: result?.updateInfo })}\n`);
  } catch (err) {
    appendLog(`[updater] Check error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function showLauncherMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return appWindow ? dialog.showMessageBox(appWindow, options) : dialog.showMessageBox(options);
}

async function killPortListeners(ports: readonly number[], showLogs = true): Promise<void> {
  if (process.platform === "win32") {
    appendLog("Automatic port cleanup is not implemented on Windows/WSL. Stop existing listeners manually.\n");
    return;
  }
  if (showLogs) showLogView();

  for (const port of ports) {
    const pids = await signalPortPids(port, "SIGTERM");
    if (pids.length === 0) continue;

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    if (await canConnect(port)) {
      appendLog(`Port ${port} still occupied after SIGTERM — escalating to SIGKILL.\n`);
      await signalPortPids(port, "SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    if (await canConnect(port)) {
      appendLog(`Warning: port ${port} is still in use after SIGKILL.\n`);
    }
  }
}

async function runOpenChamberCli(args: string[], opts: { soft?: boolean } = {}): Promise<void> {
  const command = resolveOpenChamberCommand();
  if (!command) {
    appendLog("OpenChamber CLI not found — falling back to port cleanup.\n");
    await killPortListeners([CHAMBER_PORT]);
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command.cmd, [...command.argsPrefix, ...args], { stdio: "pipe", env: openChamberEnv() });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (code) => {
      if (output.trim()) appendLog(output.trimEnd() + "\n");
      if (code !== 0) {
        const message = `openchamber ${args.join(" ")} exited with code ${code}.`;
        appendLog(`${message}\n`);
        if (!opts.soft) {
          reject(new Error(message));
          return;
        }
      }
      resolve();
    });
    child.on("error", (err) => {
      appendLog(`openchamber error: ${err.message}\n`);
      if (!opts.soft) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function openDevHub(): Promise<void> {
  const window = createLauncherWindow();
  window.setTitle("DevHub");
  window.setSize(1280, 900);
  window.focus();
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({ storages: ["cachestorage", "serviceworkers"] });
  await window.loadURL(dashboardUrl());
}

async function restartOpenChamber(): Promise<void> {
  chamberProcess?.kill("SIGTERM");
  chamberProcess = null;

  showLogView();
  appendLog("Restarting OpenChamber via native CLI...\n");
  await runOpenChamberCli(["stop", "--port", String(CHAMBER_PORT), "--quiet"]);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await runOpenChamberCli(["serve", "--port", String(CHAMBER_PORT), "--host", "0.0.0.0", "--quiet"]);

  if (await canConnect(CHAMBER_PORT)) {
    appendLog("OpenChamber is ready.\n");
    await openDevHub();
    return;
  }

  setStatus("Waiting for OpenChamber...");
  const started = await new Promise<boolean>((resolve) => {
    let attempts = 0;
    const max = 60;
    const iv = setInterval(async () => {
      attempts++;
      if (await canConnect(CHAMBER_PORT)) {
        clearInterval(iv);
        resolve(true);
      } else if (attempts >= max) {
        clearInterval(iv);
        resolve(false);
      }
    }, 1_000);
  });

  if (started) {
    appendLog("OpenChamber is ready.\n");
    setStatus("");
    await openDevHub();
  } else {
    appendLog("Timed out waiting for OpenChamber.\n");
    setStatus("Timed out — use Back to DevHub to return.");
  }
}

async function restartOpenCode(): Promise<void> {
  showLogView();
  appendLog("Restarting OpenCode...\n");
  await killPortListeners([OPENCODE_PORT]);

  const binary = resolveOpenCodeBinary();
  appendLog(`Starting: ${binary} serve --port ${OPENCODE_PORT} --hostname 0.0.0.0\n`);
  const child = spawn(binary, ["serve", "--port", String(OPENCODE_PORT), "--hostname", "0.0.0.0"], {
    detached: true,
    stdio: "ignore",
    env: openCodeEnv(),
  });
  child.unref();

  setStatus("Waiting for OpenCode...");
  const started = await new Promise<boolean>((resolve) => {
    let attempts = 0;
    const max = 60;
    const iv = setInterval(async () => {
      attempts++;
      if (await canConnect(OPENCODE_PORT)) {
        clearInterval(iv);
        resolve(true);
      } else if (attempts >= max) {
        clearInterval(iv);
        resolve(false);
      }
    }, 1_000);
  });

  if (started) {
    appendLog("OpenCode is ready.\n");
    setStatus("");
    await openDevHub();
  } else {
    appendLog("Timed out waiting for OpenCode.\n");
    setStatus("Timed out — use Back to DevHub to return.");
  }
}

async function stopActiveProcessForRestart(): Promise<void> {
  if (!activeProcess) return;
  const proc = activeProcess;
  activeProcess = null;
  activeScript = null;
  appendLog("Stopping current DevHub process before switching modes...\n");
  proc.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, PROCESS_EXIT_WAIT_MS));
}

async function waitForPortFree(port: number): Promise<boolean> {
  for (let i = 0; i < PORT_POLL_MAX_ATTEMPTS; i++) {
    if (!(await canConnect(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, PORT_POLL_INTERVAL_MS));
  }
  return false;
}

function spawnDetached(args: readonly string[]): void {
  appendLog(`Spawning detached: ${npmBin} ${args.join(" ")}\n`);
  const child = spawn(npmBin, [...args], {
    cwd: projectRoot(),
    env: cleanNpmEnv(),
    shell: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function cleanupDevHubProcesses(): Promise<void> {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const settings = loadSettings();
    const keepDashboard = !settings.killDashboardOnClose;
    const keepChamber = !settings.killChamberOnClose;
    const script = activeScript ?? lastScript;

    await stopActiveProcessForRestart();

    if (keepChamber) {
      await runOpenChamberCli(["stop", "--port", String(CHAMBER_PORT), "--quiet"], { soft: true });
    }

    const portsToKill: number[] = [];
    if (settings.killDashboardOnClose) portsToKill.push(DASHBOARD_PORT);
    if (settings.killChamberOnClose) portsToKill.push(CHAMBER_PORT);
    if (settings.killOpenCodeOnClose) portsToKill.push(OPENCODE_PORT);

    if (portsToKill.length > 0) {
      await killPortListeners(portsToKill, false);
    }

    if (keepDashboard) {
      await waitForPortFree(DASHBOARD_PORT);
      spawnDetached(["run", script]);
    }
  })();
  return cleanupPromise;
}

async function quitAfterCleanup(): Promise<void> {
  if (quittingAfterCleanup) return;
  quittingAfterCleanup = true;
  await cleanupDevHubProcesses();
  cleanupComplete = true;
  appWindow?.destroy();
  app.quit();
}

async function runMenuAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const options = {
      type: "error",
      title: "DevHub Launcher Error",
      message: error instanceof Error ? error.message : String(error),
    } as const;
    if (appWindow) {
      await dialog.showMessageBox(appWindow, options);
      return;
    }
    await dialog.showMessageBox(options);
  }
}

function installMenu(): void {
  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [appMenu] : []),
    {
      label: "File",
      submenu: [
        { label: "Open DevHub", click: () => void runMenuAction(openDevHub) },
        { label: "Show Logs", click: () => showLogView() },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Tools",
      submenu: [
        { label: "Check for Updates", click: () => void runMenuAction(() => checkForUpdates(true)) },
        { type: "separator" },
        { label: "Reinstall Dependencies", click: () => void runMenuAction(reinstallDependenciesAndRestart) },
        { type: "separator" },
        { label: "Switch to Dev", click: () => void runMenuAction(() => startScript("dev", true)) },
        { label: "Switch to Production", click: () => void runMenuAction(() => startScript("start", true)) },
        { type: "separator" },
        { label: "Restart OpenChamber", click: () => void runMenuAction(restartOpenChamber) },
        { label: "Restart OpenCode", click: () => void runMenuAction(restartOpenCode) },
        { type: "separator" },
        {
          label: "Kill Dashboard on Close",
          type: "checkbox",
          checked: loadSettings().killDashboardOnClose,
          click: (menuItem) => {
            const s = loadSettings();
            s.killDashboardOnClose = menuItem.checked;
            saveSettings(s);
          },
        },
        {
          label: "Kill OpenChamber on Close",
          type: "checkbox",
          checked: loadSettings().killChamberOnClose,
          click: (menuItem) => {
            const s = loadSettings();
            s.killChamberOnClose = menuItem.checked;
            saveSettings(s);
          },
        },
        {
          label: "Kill OpenCode on Close",
          type: "checkbox",
          checked: loadSettings().killOpenCodeOnClose,
          click: (menuItem) => {
            const s = loadSettings();
            s.killOpenCodeOnClose = menuItem.checked;
            saveSettings(s);
          },
        },
      ],
    },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function startScript(script: LaunchScript, restart = false): Promise<void> {
  if (restart) {
    showLogView();
    await stopActiveProcessForRestart();
    await killPortListeners([DASHBOARD_PORT, CHAMBER_PORT, OPENCODE_PORT, TERMINAL_PORT]);
  }

  if (await canConnect(DASHBOARD_PORT, dashboardHost())) {
    appendLog(`DevHub is already available at ${dashboardUrl()}; opening existing instance.\n`);
    await openDevHub();
    return;
  }

  await ensureDependencies(false);
  if (script === "start") await ensureProductionBuild(true);
  showLogView();
  setStatus(`Running npm run ${script}...`);
  appendLog(`Starting npm run ${script}...\n`);
  lastScript = script;
  activeScript = script;
  activeProcess = spawnNpm(["run", script]);
  activeProcess.on("close", (code) => {
    appendLog(`npm run ${script} exited with code ${code}.\n`);
    activeProcess = null;
    activeScript = null;
  });

  setStatus(`Waiting for ${dashboardUrl()}...`);
  if (!(await waitForDashboard())) {
    throw new Error(`Timed out waiting for ${dashboardUrl()}`);
  }

  setStatus("Opening DevHub...");
  await openDevHub();
  setStatus("");
}

async function chooseWhenRunning(): Promise<void> {
  createLauncherWindow();
  const [chamberUp, opencodeUp] = await Promise.all([canConnect(CHAMBER_PORT), canConnect(OPENCODE_PORT)]);
  const { response } = await dialog.showMessageBox(appWindow!, {
    type: "question",
    title: "DevHub is already running",
    message: `Dashboard is reachable on ${DASHBOARD_PORT}. OpenChamber ${chamberUp ? "is" : "is not"} reachable on ${CHAMBER_PORT}. OpenCode ${opencodeUp ? "is" : "is not"} reachable on ${OPENCODE_PORT}.`,
    detail: "Open the existing app, or restart the local listeners and choose a mode.",
    buttons: ["Open Existing", "Restart Dev", "Restart Production", "Quit"],
    defaultId: 0,
    cancelId: 3,
  });

  if (response === 0) await openDevHub();
  if (response === 1) await startScript("dev", true);
  if (response === 2) await startScript("start", true);
  if (response === 3) app.quit();
}

async function chooseWhenStopped(): Promise<void> {
  createLauncherWindow();
  const { response } = await dialog.showMessageBox(appWindow!, {
    type: "question",
    title: "Start DevHub",
    message: "DevHub is not reachable on port 1337.",
    detail: "Choose Dev for normal local work. Production runs npm run start. Install/Reinstall only updates dependencies.",
    buttons: ["Dev", "Production", "Install/Reinstall", "Quit"],
    defaultId: 0,
    cancelId: 3,
  });

  if (response === 0) await startScript("dev");
  if (response === 1) await startScript("start");
  if (response === 2) {
    await ensureDependencies(true);
    await chooseWhenStopped();
  }
  if (response === 3) app.quit();
}

async function ensureOnePasswordSignedIn(): Promise<void> {
  try {
    const { execSync } = await import("node:child_process");
    const result = execSync("op whoami", {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (result) {
      appendLog(`[1password] Signed in as: ${result}\n`);
      return;
    }
  } catch {
    appendLog("[1password] Not signed in.\n");
  }

  const response = await showLauncherMessageBox({
    type: "warning",
    title: "1Password Not Signed In",
    message: "DevHub needs 1Password for secrets (API keys, tokens).",
    detail: "Sign in now, or skip (some features won't work).",
    buttons: ["Sign In", "Skip"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response.response === 1) {
    appendLog("[1password] User chose to skip.\n");
    return;
  }

  appendLog("[1password] Showing sign-in form...\n");

  const promptWindow = new BrowserWindow({
    width: 420,
    height: 360,
    useContentSize: true,
    title: "1Password Sign-In",
    parent: appWindow ?? undefined,
    modal: Boolean(appWindow),
    icon: appIconPath(),
    resizable: false,
    minimizable: false,
    maximizable: false,
  });

  const emailStore = path.join(app.getPath("userData"), "op-email.txt");
  const savedEmail = fs.existsSync(emailStore) ? fs.readFileSync(emailStore, "utf8").trim() : "";

  const html = `<!doctype html><html><head><title>1Password Sign-In</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font:14px system-ui;height:100vh;overflow:hidden;padding:24px}
form{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px}
h2{font-size:16px;margin-bottom:14px;color:#f0f6fc}
label{display:block;font-size:12px;color:#8b949e;margin-bottom:5px}
input{width:100%;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;font-size:14px;margin-bottom:14px;outline:none}
input:focus{border-color:#58a6ff}
button{width:100%;padding:10px;background:#238636;color:#fff;border:1px solid #2ea043;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#2ea043}
.cancel{background:transparent;color:#8b949e;border-color:#30363d;margin-top:8px}
.cancel:hover{border-color:#8b949e;color:#f0f6fc}
.err{color:#f85149;font-size:12px;margin-bottom:12px;display:none}
</style></head>
<body>
<form id="op-form">
<h2>Sign in to 1Password</h2>
<div class="err" id="err"></div>
<label>Email</label>
<input type="email" id="email" placeholder="you@example.com" required value="${escapeHtml(savedEmail)}" />
<label>Master Password</label>
<input type="password" id="password" placeholder="Master password" required autofocus />
<button type="submit">Sign In</button>
<button type="button" class="cancel" onclick="window.close()">Cancel</button>
</form>
<script>
document.getElementById('op-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) return;
  document.getElementById('err').textContent = 'Signing in...';
  document.getElementById('err').style.display = 'block';
  location.href = 'devhub://op-signin/?email=' + encodeURIComponent(email) + '&password=' + encodeURIComponent(password);
});
</script></body></html>`;

  await new Promise<void>((resolve) => {
    void promptWindow.webContents.once("did-finish-load", () => resolve());
    void promptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  void promptWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("devhub://op-signin/")) {
      event.preventDefault();
      const parsed = new URL(url);
      const email = parsed.searchParams.get("email") ?? "";
      const password = parsed.searchParams.get("password") ?? "";
      void (async () => {
        try {
          const { execFileSync } = await import("node:child_process");
          appendLog("[1password] Running op signin...\n");
          const output = execFileSync("op", ["signin", "--raw"], {
            encoding: "utf8",
            timeout: 30_000,
            env: { ...process.env, OP_PASSWORD: password },
            input: password,
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          if (output && output.length > 10) {
            appendLog("[1password] Sign-in successful.\n");
            process.env.OP_SESSION = output;
            fs.mkdirSync(app.getPath("userData"), { recursive: true });
            fs.writeFileSync(emailStore, email, "utf8");
            promptWindow.close();
            return;
          }
          appendLog(`[1password] Unexpected output: ${output}\n`);
        } catch (err) {
          appendLog(`[1password] Sign-in failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        void promptWindow.webContents.executeJavaScript(`
          document.getElementById('err').textContent = 'Sign-in failed. Check your credentials.';
          document.getElementById('err').style.display = 'block';
        `);
      })();
    }
  });

  await new Promise<void>((resolve) => {
    promptWindow.on("closed", () => resolve());
  });

  appendLog("[1password] Sign-in form closed.\n");
}

async function launch(): Promise<void> {
  await ensureProjectRoot();
  createLauncherWindow();
  appWindow!.setTitle(`DevHub v${app.getVersion()}`);
  await ensureOnePasswordSignedIn();
  if (await canConnect(DASHBOARD_PORT, dashboardHost())) {
    await chooseWhenRunning();
    return;
  }
  await chooseWhenStopped();
}

app.setName("DevHub");
console.log(`[devhub] v${app.getVersion()} launcher starting`);

// Single instance: a second launch (e.g. clicking the Start Menu icon again)
// would spawn a rival launcher fighting over the same ports. Focus the existing
// window instead. Quit before registering cleanup handlers so the loser never
// runs teardown on the winner's processes.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!appWindow) return;
    if (appWindow.isMinimized()) appWindow.restore();
    appWindow.focus();
  });

  app.whenReady().then(async () => {
    configureAutoUpdater();
    installMenu();
    await launch();
    setTimeout(() => void checkForUpdates(false), 5_000);
  }).catch(async (error) => {
    await dialog.showMessageBox({
      type: "error",
      title: "DevHub Launcher Error",
      message: error instanceof Error ? error.message : String(error),
    });
  });

  app.on("before-quit", (event) => {
    if (cleanupComplete) return;
    event.preventDefault();
    void quitAfterCleanup();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
