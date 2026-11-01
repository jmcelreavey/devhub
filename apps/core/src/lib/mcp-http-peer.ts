/**
 * Starts the HTTP MCP entry (packages/mcp/src/http.ts) with the
 * dashboard, so URL-based MCP clients have something to connect to without a
 * terminal left open.
 *
 * It runs from the linked checkout — the MCP server is not bundled into the
 * desktop app — and is pointed at *this* dashboard and its content dirs rather
 * than whatever a synced client config says. Skipped when DEVHUB_MCP_HTTP=0,
 * there is no checkout, the MCP package isn't installed, or something else
 * listens on the port (a second DevHub, or a manual `npm run mcp:http`).
 *
 * The child gets this dashboard's pid and exits when the dashboard is gone.
 * A peer that outlived its dashboard anyway (force-quit, or one started before
 * that watch existed) is replaced at boot rather than skipped, so a rebuild,
 * reinstall or relaunch always serves the checkout's current MCP code.
 */
import { localOps } from "../local/ops/index";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDocsDir, getNotesDir, getTasksDir } from "./content/dirs";
import { buildRuntimeInfo } from "./dashboard-runtime";
import { getCheckoutRoot } from "./desktop/runtime-paths";
import { execExternal } from "./exec-external";
import { resolvePluginPaths } from "./plugins/paths";
import { canConnect, commandAndEnvForPid, commandForPid, pidsListeningOnPort } from "./port-probe";
import { augmentedPathEnv, scrubDesktopRuntimeEnv } from "../local/process-env";

export const DEFAULT_MCP_HTTP_PORT = 1340;

let child: ReturnType<typeof localOps.spawn> | null = null;

export function mcpHttpAutostartEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return env.DEVHUB_MCP_HTTP !== "0" && env.NODE_ENV !== "test";
}

export function mcpHttpBaseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.WSL_DISTRO_NAME) resolvePluginPaths({ env });
  const clean = scrubDesktopRuntimeEnv(env);
  const configDir = env.DEVHUB_CONFIG_DIR?.trim();
  if (configDir) clean.DEVHUB_CONFIG_DIR = env.WSL_DISTRO_NAME ? env.DEVHUB_CONFIG_DIR : path.resolve(configDir);
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (!configDir && !env.WSL_DISTRO_NAME && xdgConfigHome && !path.isAbsolute(xdgConfigHome)) {
    clean.XDG_CONFIG_HOME = path.resolve(xdgConfigHome);
  }
  if (env.DEVHUB_MCP_TOOLSETS !== undefined) clean.DEVHUB_MCP_TOOLSETS = env.DEVHUB_MCP_TOOLSETS;
  return clean;
}

export function mcpHttpPort(env: Partial<NodeJS.ProcessEnv> = process.env): number {
  const raw = env.DEVHUB_MCP_HTTP_PORT?.trim() ?? "";
  const port = Number(raw);
  const fallback = env.DEVHUB_CHECKOUT_DEV === "1" ? 1440 : DEFAULT_MCP_HTTP_PORT;
  return /^\d+$/.test(raw) && Number.isInteger(port) && port > 0 && port < 65_536 ? port : fallback;
}

/** The checkout's tsx and HTTP entry, or null when the MCP package isn't installed. */
export function mcpHttpEntry(checkoutRoot: string): { tsx: string; entry: string; cwd: string } | null {
  const cwd = path.join(checkoutRoot, "packages", "mcp");
  const tsx = path.join(checkoutRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const entry = path.join(cwd, "src", "http.ts");
  return fs.existsSync(tsx) && fs.existsSync(entry) ? { tsx, entry, cwd } : null;
}

export function mcpHttpLogPath(home = os.homedir()): string {
  return path.join(home, ".local", "state", "devhub", "mcp-http.log");
}

/** Set on the child; http.ts exits when this pid is gone. */
export const PARENT_PID_ENV = "DEVHUB_MCP_HTTP_PARENT_PID";

export interface PortListener {
  pid: number;
  /** `ps eww` output for the listener: command line plus environment. */
  commandAndEnv: string;
  /** The process that launched it (normally the tsx wrapper). */
  launcherPid: number | null;
  launcherCommand: string | null;
  launcherParentPid: number | null;
}

/**
 * The pids to stop when every listener on the port is this checkout's HTTP MCP
 * left behind by a dashboard that is no longer running. Anything else on the
 * port — a foreign server, or a peer a live DevHub owns — returns [] so the
 * port is left alone.
 */
export function stalePeerPids(listeners: PortListener[], entry: string, isAlive: (pid: number) => boolean): number[] {
  const pids: number[] = [];
  for (const listener of listeners) {
    if (!listener.commandAndEnv.includes(entry)) return [];
    const owner = new RegExp(`${PARENT_PID_ENV}=(\\d+)`).exec(listener.commandAndEnv);
    // Peers started before the parent pid was recorded count as stale once
    // their launcher has been re-parented to launchd (pid 1).
    const stale = owner
      ? !isAlive(Number(owner[1]))
      : listener.launcherPid === 1 || listener.launcherParentPid === 1;
    if (!stale) return [];
    pids.push(listener.pid);
    if (listener.launcherPid && listener.launcherPid > 1 && listener.launcherCommand?.includes(entry)) {
      pids.push(listener.launcherPid);
    }
  }
  return pids;
}

async function parentPidOf(pid: number): Promise<number | null> {
  try {
    const result = await execExternal("ps", ["-o", "ppid=", "-p", String(pid)], {
      timeoutMs: 3_000,
      label: "mcp-http:parent-pid",
    });
    const parentPid = Number.parseInt(result.stdout.trim(), 10);
    return Number.isInteger(parentPid) ? parentPid : null;
  } catch {
    return null;
  }
}

async function describeListener(pid: number): Promise<PortListener> {
  const [launcherPid, commandAndEnv] = await Promise.all([parentPidOf(pid), commandAndEnvForPid(pid)]);
  let launcherCommand: string | null = null;
  let launcherParentPid: number | null = null;
  if (launcherPid !== null && launcherPid > 1) {
    [launcherCommand, launcherParentPid] = await Promise.all([commandForPid(launcherPid), parentPidOf(launcherPid)]);
  }
  return {
    pid,
    commandAndEnv,
    launcherPid,
    launcherCommand,
    launcherParentPid,
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalAll(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await canConnect(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !(await canConnect(port));
}

export async function startMcpHttpPeer(log: (msg: string) => void = (msg) => console.log(`[mcp-http] ${msg}`)): Promise<void> {
  if (!mcpHttpAutostartEnabled() || child) return;

  const checkout = getCheckoutRoot();
  if (!checkout) {
    log("no linked DevHub checkout — HTTP MCP not started");
    return;
  }
  const target = mcpHttpEntry(checkout);
  if (!target) {
    log(`MCP package not installed in ${checkout}/packages/mcp — run npm install from the checkout root to enable HTTP MCP`);
    return;
  }
  let childEnv: NodeJS.ProcessEnv;
  try {
    childEnv = mcpHttpBaseEnv(augmentedPathEnv());
  } catch (error) {
    log(`HTTP MCP not started: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const port = mcpHttpPort();
  if (await canConnect(port)) {
    const listeners = await pidsListeningOnPort(port);
    const descriptions = await Promise.all(listeners.map(describeListener));
    const stale = stalePeerPids(descriptions, target.entry, processAlive);
    if (stale.length === 0) {
      log(`port ${port} already has a listener — leaving it alone`);
      return;
    }
    log(`replacing stale HTTP MCP on port ${port} (pid ${stale.join(", ")}) left by a DevHub that is no longer running`);
    signalAll(stale, "SIGTERM");
    if (!(await waitForPortFree(port, 5_000))) {
      signalAll(stale, "SIGKILL");
      if (!(await waitForPortFree(port, 2_000))) {
        log(`port ${port} is still in use after stopping the stale HTTP MCP — not starting another`);
        return;
      }
    }
  }

  const logFile = mcpHttpLogPath();
  fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
  const out = fs.openSync(logFile, "a", 0o600);
  try {
    child = localOps.spawn(process.execPath, [target.tsx, target.entry], {
      cwd: target.cwd,
      stdio: ["ignore", out, out],
      env: {
        ...childEnv,
        REPO_ROOT: checkout,
        NOTES_DIR: getNotesDir(),
        TASKS_DIR: getTasksDir(),
        DOCS_DIR: getDocsDir(),
        DEVHUB_BASE_URL: buildRuntimeInfo().baseUrl,
        DEVHUB_MCP_HTTP_PORT: String(port),
        [PARENT_PID_ENV]: String(process.pid),
      },
    });
  } finally {
    // The child holds its own copy of the descriptor.
    fs.closeSync(out);
  }

  const started = child;
  started.once("error", (err) => {
    log(`HTTP MCP failed to start: ${err.message}`);
    if (child === started) child = null;
  });
  started.once("exit", (code, signal) => {
    log(`HTTP MCP exited (${signal ?? `code ${code}`}) — see ${logFile}`);
    if (child === started) child = null;
  });
  log(`HTTP MCP starting on http://127.0.0.1:${port}/mcp (log: ${logFile})`);
}
