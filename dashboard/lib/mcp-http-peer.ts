/**
 * Starts the HTTP MCP entry (mcp-servers/devhub-server/src/http.ts) with the
 * dashboard, so URL-based MCP clients have something to connect to without a
 * terminal left open.
 *
 * It runs from the linked checkout — the MCP server is not bundled into the
 * desktop app — and is pointed at *this* dashboard and its content dirs rather
 * than whatever a synced client config says. Skipped when DEVHUB_MCP_HTTP=0,
 * there is no checkout, the MCP package isn't installed, or something already
 * listens on the port (a second DevHub, or a manual `npm run mcp:http`).
 *
 * Not detached: the child lives in the dashboard's process group and goes away
 * with it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDocsDir, getNotesDir, getTasksDir } from "@/lib/content/dirs";
import { buildRuntimeInfo } from "@/lib/dashboard-runtime";
import { getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { canConnect } from "@/lib/port-probe";
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
    log(`port ${port} already has a listener — leaving it alone`);
    return;
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
