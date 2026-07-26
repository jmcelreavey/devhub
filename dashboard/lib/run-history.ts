import fs from "node:fs";
import path from "node:path";
// Same import scripts-runner.ts uses, so reader and writer agree on the path.
import { getHome } from "@/lib/notes/dir";

/**
 * Reads back the run audit log that `scripts-runner` has been writing all along.
 *
 * `writeAuditLog()` appends one JSON line per finished run to
 * `~/.local/state/devhub/runs.jsonl`. Nothing has ever read it. So the answer to
 * "what did DevHub do while I was away?" was sitting on disk with no way to ask
 * — which is the substance of R1 in the roadmap, minus the parts that turned out
 * to already exist (a live registry, SSE streaming, per-run log payloads).
 *
 * Deliberately read-only and defensive: this is an audit trail, and a corrupt
 * line in it should cost you one row, not the whole view.
 */
export interface RunHistoryEntry {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

export interface RunHistoryRow extends RunHistoryEntry {
  /** Wall-clock duration, when the run recorded a finish. */
  durationMs?: number;
  /** exitCode 0, or still running. Anything else failed. */
  ok: boolean;
}

/** Cap the tail we parse — this file grows forever and is never rotated. */
const MAX_BYTES = 512 * 1024;

export function runsLogPath(): string {
  return path.join(getHome(), ".local/state/devhub", "runs.jsonl");
}

/** One JSONL line -> entry, or null if it's not usable. */
export function parseRunLine(line: string): RunHistoryEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const e = parsed as Partial<RunHistoryEntry>;
    if (typeof e.runId !== "string" || typeof e.script !== "string") return null;
    if (typeof e.startedAt !== "number") return null;
    return {
      runId: e.runId,
      script: e.script,
      startedAt: e.startedAt,
      finishedAt: typeof e.finishedAt === "number" ? e.finishedAt : undefined,
      exitCode: typeof e.exitCode === "number" ? e.exitCode : undefined,
    };
  } catch {
    return null;
  }
}

export function toRow(entry: RunHistoryEntry): RunHistoryRow {
  return {
    ...entry,
    durationMs:
      entry.finishedAt !== undefined ? Math.max(0, entry.finishedAt - entry.startedAt) : undefined,
    // A run with no exit code hasn't reported failure — treat it as fine rather
    // than alarming. Only a non-zero code is a failure.
    ok: entry.exitCode === undefined || entry.exitCode === 0,
  };
}

/**
 * Most recent runs first. Reads only the tail of the file, because it is
 * append-only and unrotated — on a machine that's been running DevHub for a
 * year, parsing all of it to show ten rows would be silly.
 */
export function listRecentRuns(limit = 25): RunHistoryRow[] {
  const file = runsLogPath();
  let text: string;
  try {
    const { size } = fs.statSync(file);
    const start = Math.max(0, size - MAX_BYTES);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(Math.min(size, MAX_BYTES));
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    // A mid-file seek almost certainly lands inside a line; drop the partial.
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
  } catch {
    return [];
  }

  const rows: RunHistoryRow[] = [];
  for (const line of text.split("\n")) {
    const entry = parseRunLine(line);
    if (entry) rows.push(toRow(entry));
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

/** Failures in the window, newest first — the half you actually need to see. */
export function listRecentFailures(limit = 10): RunHistoryRow[] {
  return listRecentRuns(200)
    .filter((r) => !r.ok)
    .slice(0, limit);
}
