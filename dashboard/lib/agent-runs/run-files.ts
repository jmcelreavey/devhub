/**
 * On-disk layout of one agent run: `<runs-dir>/<run-id>/`
 *
 * - `spec.json`    — what to run (written once by the dashboard)
 * - `status.json`  — lifecycle state (written by the runner; reconciled by the dashboard)
 * - `events.jsonl` — normalised events, one per line; line index == `seq`
 *
 * Files rather than dashboard memory because the runner is a separate process
 * living in a terminal tab, and a Next reload must not orphan a run's history.
 * Pure node — the runner script imports this without the `@/` alias.
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentStreamFormat, RecordedAgentRunEvent } from "./events";

export type AgentRunState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export function isActiveAgentRunState(state: AgentRunState): boolean {
  return state === "queued" || state === "running";
}

export interface AgentRunWorktree {
  path: string;
  branch: string;
  repoRoot: string;
}

export interface AgentRunSpec {
  id: string;
  provider: string;
  providerLabel: string;
  /** Absolute binary path, resolved at dispatch so the runner does not depend on the tab's PATH. */
  bin: string;
  args: string[];
  format: AgentStreamFormat;
  cwd: string;
  title: string;
  prompt: string;
  model?: string;
  /** Nesting level of the run itself (a run started by a human is 0). */
  depth: number;
  createdAt: number;
  parentRunId?: string;
  /** HEAD when the run was dispatched — the base for `agent_diff`. */
  baseSha?: string;
  worktree?: AgentRunWorktree;
}

export interface AgentRunStatus {
  state: AgentRunState;
  updatedAt: number;
  eventCount: number;
  proposalId?: string;
  /** Runner (wrapper) pid — signalling it tears down the CLI it spawned. */
  pid?: number;
  terminalSessionId?: string;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  /** The CLI's own session id, used to resume for follow-ups. */
  sessionId?: string;
  resultText?: string;
  costUsd?: number;
  turns?: number;
  error?: string;
}

const SPEC_FILE = "spec.json";
const STATUS_FILE = "status.json";
const EVENTS_FILE = "events.jsonl";

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Write-then-rename so a concurrent reader never sees half a file. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readRunSpec(dir: string): AgentRunSpec | null {
  return readJson<AgentRunSpec>(path.join(dir, SPEC_FILE));
}

export function writeRunSpec(dir: string, spec: AgentRunSpec): void {
  writeJsonAtomic(path.join(dir, SPEC_FILE), spec);
}

export function readRunStatus(dir: string): AgentRunStatus | null {
  return readJson<AgentRunStatus>(path.join(dir, STATUS_FILE));
}

export function writeRunStatus(dir: string, status: AgentRunStatus): AgentRunStatus {
  const next = { ...status, updatedAt: Date.now() };
  writeJsonAtomic(path.join(dir, STATUS_FILE), next);
  return next;
}

export function appendRunEvent(dir: string, event: RecordedAgentRunEvent): void {
  fs.appendFileSync(path.join(dir, EVENTS_FILE), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

export interface RunEventPage {
  events: RecordedAgentRunEvent[];
  /** Cursor for the next call. Equal to `since` when nothing new arrived. */
  next: number;
  total: number;
}

/**
 * Read position per run dir: byte offset of the first unread line, and how
 * many complete lines precede it. `agent_wait` polls with a monotonic cursor,
 * so steady-state reads touch only the tail instead of the whole file — a
 * multi-hour run otherwise re-reads megabytes on every 1.5s poll.
 */
const readOffsets = new Map<string, { offset: number; lines: number; size: number }>();

/** Test seam: drop the per-process read offsets. */
export function resetRunEventOffsets(): void {
  readOffsets.clear();
}

/** Events with `seq >= since`, oldest first, tail-reading when the cursor allows. */
export function readRunEvents(dir: string, since = 0, limit = 200): RunEventPage {
  const file = path.join(dir, EVENTS_FILE);
  let fd: number;
  let size: number;
  try {
    fd = fs.openSync(file, "r");
    size = fs.fstatSync(fd).size;
  } catch {
    readOffsets.delete(dir);
    return { events: [], next: since, total: 0 };
  }

  try {
    const cached = readOffsets.get(dir);
    // The cache is only valid while the file only grew: same fd world, append-only.
    let startOffset = 0;
    let startLine = 0;
    if (cached && size >= cached.size && since >= cached.lines) {
      startOffset = cached.offset;
      startLine = cached.lines;
    }

    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(64 * 1024);
    let position = startOffset;
    while (position < size) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (read <= 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, read)));
      position += read;
    }
    const raw = Buffer.concat(chunks).toString("utf8");

    // Only newline-terminated lines are complete; the runner may be mid-append.
    const lastNewline = raw.lastIndexOf("\n");
    const complete = lastNewline === -1 ? "" : raw.slice(0, lastNewline + 1);
    const lines = complete.split("\n").filter(Boolean);
    const total = startLine + lines.length;

    // Remember where line `total` starts so the next tail read resumes there.
    if (lines.length > 0) {
      const consumedBytes = Buffer.byteLength(complete, "utf8");
      readOffsets.set(dir, { offset: startOffset + consumedBytes, lines: total, size });
    } else if (cached) {
      // No complete new lines; keep the old position but refresh the size.
      readOffsets.set(dir, { ...cached, size });
    }

    const skip = Math.max(0, since - startLine);
    const events: RecordedAgentRunEvent[] = [];
    for (const line of lines.slice(skip, skip + limit)) {
      try {
        events.push(JSON.parse(line) as RecordedAgentRunEvent);
      } catch {
        break;
      }
    }
    return { events, next: since + events.length, total };
  } finally {
    fs.closeSync(fd);
  }
}
