import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { getRepoRoot } from "@/lib/notes-dir";
import {
  listSharedMcpServerNames,
  readSharedMcpServer,
  substituteRepoRoot,
} from "@/lib/sync-mcp";

export const dynamic = "force-dynamic";

interface McpRuntimeEntry {
  name: string;
  command: string;
  /** The fingerprint we matched against process command lines. */
  fingerprint: string;
  binaryExists: boolean;
  runningCount: number;
  pids: number[];
}

interface PsRow {
  pid: number;
  ppid: number;
  command: string;
}

/** Parse one line from `ps -axo pid=,ppid=,command=`. */
function parsePsLine(line: string): PsRow | null {
  const trimmed = line.trim();
  const first = trimmed.indexOf(" ");
  if (first === -1) return null;
  const pid = Number.parseInt(trimmed.slice(0, first), 10);
  const afterPid = trimmed.slice(first + 1).trimStart();
  const second = afterPid.indexOf(" ");
  if (second === -1) return null;
  const ppid = Number.parseInt(afterPid.slice(0, second), 10);
  const command = afterPid.slice(second + 1).trimStart();
  if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;
  return { pid, ppid, command };
}

/**
 * `ps` can list several PIDs per logical stdio server (e.g. tsx wrapper + child
 * node both include the same script path in argv). Drop rows whose parent is
 * also a match so runningCount reflects sessions, not every process in the tree.
 */
function dedupeMatchingPids(rows: PsRow[]): number[] {
  const matchPids = new Set(rows.map((r) => r.pid));
  return rows.filter((r) => !matchPids.has(r.ppid)).map((r) => r.pid);
}

/**
 * Whether a server's launch command resolves. A path (absolute/relative) must
 * exist on disk; a bare command name (npx, node, docker, uvx, bunx, …) only has
 * to be resolvable on PATH — those aren't "missing binaries".
 */
function commandResolves(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) return fs.existsSync(command);
  const finder = process.platform === "win32" ? "where" : "which";
  const which = spawnSync(finder, [command], { encoding: "utf-8", timeout: 2_000 });
  return which.status === 0 && which.stdout.trim().length > 0;
}

/** Best identifying string for a server: first arg (script path) if any, else command. */
function chooseFingerprint(command: string, args: string[] | undefined): string {
  if (args && args.length > 0) {
    // Pick the longest token containing a path separator — that's the script
    // path. Falls back to first arg, then the command itself.
    const candidate = [...args].sort((a, b) => b.length - a.length).find((a) => a.includes("/"));
    if (candidate) return candidate;
    return args[0];
  }
  return command;
}

/**
 * Scans running processes for stdio MCP servers configured under
 * `mcp/shared/`. Match by argv substring against each server's fingerprint
 * (script path or command). No per-agent breakdown — one row per server.
 */
export async function GET() {
  const repoRoot = getRepoRoot();
  const names = listSharedMcpServerNames(repoRoot);

  const psRows: PsRow[] = [];
  try {
    const ps = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf-8", timeout: 3_000 });
    if (ps.status === 0 && ps.stdout) {
      for (const line of ps.stdout.split("\n")) {
        const row = parsePsLine(line);
        if (row) psRows.push(row);
      }
    }
  } catch {
    /* ps unavailable — runningCount will be 0 for everything */
  }

  const entries: McpRuntimeEntry[] = [];
  for (const name of names) {
    const server = readSharedMcpServer(repoRoot, name);
    if (!server?.command) continue;
    const command = substituteRepoRoot(server.command, repoRoot) as string;
    const args = (substituteRepoRoot(server.args ?? [], repoRoot) as string[]).filter(
      (x): x is string => typeof x === "string",
    );
    const fingerprint = chooseFingerprint(command, args);

    const matching = psRows.filter(
      (row) => row.command.includes(fingerprint) && row.pid !== process.pid,
    );
    const pids = dedupeMatchingPids(matching);
    entries.push({
      name,
      command,
      fingerprint,
      binaryExists: commandResolves(command),
      runningCount: pids.length,
      pids,
    });
  }

  return NextResponse.json({ servers: entries });
}
