import { spawnSync } from "node:child_process";

/**
 * Startup clean-up for stdio MCP servers left behind by a client that died
 * (re-parented to launchd, pid 1). Each one is a node process talking to a pipe
 * nobody reads, holding memory until reboot. The servers now exit on their own
 * when that happens (shared/process/exit-with-parent.ts); this sweeps up any
 * from older builds.
 *
 * Deliberately narrow: only processes whose command runs DevHub's own MCP
 * server sources (devhub-server, or a plugin's devhub-*-server), started by DevHub's
 * bundled node runtime or a plain `node`, and orphaned. The HTTP MCP peer has
 * its own stale-peer handling and is skipped. Descendants are reaped only when
 * they match the same server paths.
 */
export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

const SERVER_PATH = /\/mcp-servers\/devhub(?:-[a-z0-9]+)*-server\//;
const HTTP_PEER = /\/mcp-servers\/devhub-server\/src\/http\.ts\b/;
const DEVHUB_RUNTIME = /\/DevHub\.app\/Contents\/Resources\/runtime\/node[^/\s]*$/;

function executable(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

function isNodeExecutable(exe: string): boolean {
  if (DEVHUB_RUNTIME.test(exe)) return true;
  const base = exe.split("/").pop() ?? "";
  return base === "node";
}

export function isDevhubMcpCommand(command: string): boolean {
  return SERVER_PATH.test(command) && !HTTP_PEER.test(command) && isNodeExecutable(executable(command));
}

export function parsePsRows(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
}

/** Orphaned DevHub MCP servers plus their matching descendants, never `selfPid`. */
export function orphanMcpPids(rows: readonly ProcessRow[], selfPid = process.pid): number[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const targets = new Set<number>();
  const visit = (row: ProcessRow) => {
    if (row.pid === selfPid || targets.has(row.pid) || !isDevhubMcpCommand(row.command)) return;
    targets.add(row.pid);
    for (const child of children.get(row.pid) ?? []) visit(child);
  };
  for (const row of rows) if (row.ppid === 1) visit(row);
  return [...targets];
}

function listProcesses(): ProcessRow[] {
  const res = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 });
  return res.status === 0 ? parsePsRows(res.stdout ?? "") : [];
}

function signal(pids: readonly number[], sig: NodeJS.Signals): void {
  for (const pid of pids) {
    try { process.kill(pid, sig); } catch { /* already gone */ }
  }
}

/** Never throws; returns the pids it stopped. macOS/Linux only. */
export async function reapOrphanMcpServers(
  log: (message: string) => void = (message) => console.log(`[mcp-reap] ${message}`),
  list: () => ProcessRow[] = listProcesses,
): Promise<number[]> {
  if (process.platform === "win32") return [];
  try {
    const targets = orphanMcpPids(list());
    if (targets.length === 0) return [];
    log(`stopping ${targets.length} orphaned DevHub MCP server process(es): ${targets.join(", ")}`);
    signal(targets, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    // Only escalate for pids that still run the same orphaned server, so a recycled pid is never hit.
    const still = new Set(orphanMcpPids(list()));
    signal(targets.filter((pid) => still.has(pid)), "SIGKILL");
    return targets;
  } catch (error) {
    log(`could not reap orphaned MCP servers: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
