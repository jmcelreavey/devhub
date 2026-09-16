/**
 * Starts the HTTP MCP entry (mcp-servers/devhub-server/src/http.ts) with the
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
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDocsDir, getNotesDir, getTasksDir } from "@/lib/content/dirs";
import { buildRuntimeInfo } from "@/lib/dashboard-runtime";
import { getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { canConnect, commandAndEnvForPid, commandForPid, pidsListeningOnPort } from "@/lib/port-probe";
import { augmentedPathEnv, scrubDesktopRuntimeEnv } from "@/lib/process-env";

export const DEFAULT_MCP_HTTP_PORT = 1340;

let child: ChildProcess | null = null;

export function mcpHttpAutostartEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return env.DEVHUB_MCP_HTTP !== "0" && env.NODE_ENV !== "test";
}

export function mcpHttpPort(env: Partial<NodeJS.ProcessEnv> = process.env): number {
  const n = Number.parseInt(env.DEVHUB_MCP_HTTP_PORT ?? "", 10);
  return Number.isInteger(n) && n > 0 && n < 65_536 ? n : DEFAULT_MCP_HTTP_PORT;
}

/** The checkout's tsx and HTTP entry, or null when the MCP package isn't installed. */
export function mcpHttpEntry(checkoutRoot: string): { tsx: string; entry: string; cwd: string } | null {
  const cwd = path.join(checkoutRoot, "mcp-servers", "devhub-server");
  const tsx = path.join(cwd, "node_modules", ".bin", "tsx");
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

function parentPidOf(pid: number): number | null {
  const res = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const n = Number.parseInt(res.stdout?.trim() ?? "", 10);
  return Number.isInteger(n) ? n : null;
}

function describeListener(pid: number): PortListener {
  const launcherPid = parentPidOf(pid);
  const hasLauncher = launcherPid !== null && launcherPid > 1;
  return {
    pid,
    commandAndEnv: commandAndEnvForPid(pid),
    launcherPid,
    launcherCommand: hasLauncher ? commandForPid(launcherPid) : null,
    launcherParentPid: hasLauncher ? parentPidOf(launcherPid) : null,
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
    log(`MCP package not installed in ${checkout}/mcp-servers/devhub-server — run npm install there to enable HTTP MCP`);
    return;
  }
  const port = mcpHttpPort();
  if (await canConnect(port)) {
    const stale = stalePeerPids(pidsListeningOnPort(port).map(describeListener), target.entry, processAlive);
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
    child = spawn(target.tsx, [target.entry], {
      cwd: target.cwd,
      stdio: ["ignore", out, out],
      env: {
        ...scrubDesktopRuntimeEnv(augmentedPathEnv()),
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
