/**
 * Durable link between a DevHub task and agent run(s), plus markdown handoff
 * for pause / EOD / abandon / resume.
 *
 * Sidecar layout (vault): `notes/.config/task-agent-runs/<taskId>.json`
 * plus `_index.json` mapping runId → taskId for status sync hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import type { AgentRunState } from "@/lib/agent-runs/run-files";

export const TASK_AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "paused",
  "done",
  "failed",
  "abandoned",
] as const;

export type TaskAgentRunStatus = (typeof TASK_AGENT_RUN_STATUSES)[number];

export type TaskPrState = "open" | "merged" | "closed";

/** Something on the run's PR that the agent should be sent back for. */
export interface TaskPrAttention {
  kind: "ci-failing" | "changes-requested" | "new-comments";
  /** One or two lines: failing check names, or the latest comment excerpt. */
  summary: string;
  detectedAt: string;
  /** kind + head commit + summary — a dismissal holds until this changes. */
  key: string;
}

export interface TaskAgentRunRecord {
  runId: string;
  status: TaskAgentRunStatus;
  provider?: string;
  startedAt: string;
  updatedAt: string;
  prUrl?: string;
  branch?: string;
  /** Checkout the run worked in — lets the PR watcher find a PR by branch. */
  cwd?: string;
  sessionId?: string;
  terminalSessionId?: string;
  /** Last PR state the watcher saw (task-pr-watch.ts). */
  prState?: TaskPrState;
  prCheckedAt?: string;
  /** PR activity up to here has been seen (or acted on) — newer comments raise attention. */
  prSeenAt?: string;
  attention?: TaskPrAttention;
  /** Attention key the user dismissed or already sent the agent back for. */
  attentionHandled?: string;
}

export interface TaskAgentRunsFile {
  version: 1;
  taskId: string;
  handoff: string;
  handoffUpdatedAt?: string;
  runs: TaskAgentRunRecord[];
}

interface RunIndexFile {
  version: 1;
  /** runId → taskId */
  byRunId: Record<string, string>;
}

const TASK_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const RUN_ID_RE = /^run-[a-z0-9]{6,12}-[0-9a-f]{8}$/;
const MAX_HANDOFF_CHARS = 100_000;

const EMPTY_INDEX: RunIndexFile = { version: 1, byRunId: {} };

export function isValidTaskAgentTaskId(taskId: string): boolean {
  return TASK_ID_RE.test(taskId);
}

export function isValidTaskAgentRunId(runId: string): boolean {
  return RUN_ID_RE.test(runId);
}

export function isTaskAgentRunStatus(value: string): value is TaskAgentRunStatus {
  return (TASK_AGENT_RUN_STATUSES as readonly string[]).includes(value);
}

export function isActiveTaskAgentRunStatus(status: TaskAgentRunStatus): boolean {
  return status === "queued" || status === "running";
}

/** Map an agent-run lifecycle state onto the task-sidecar status vocabulary. */
export function mapAgentRunStateToTaskStatus(state: AgentRunState): TaskAgentRunStatus {
  switch (state) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "abandoned";
  }
}

export function taskAgentRunsDir(notesDir = getNotesDir()): string {
  return path.join(notesDir, ".config", "task-agent-runs");
}

export function taskAgentRunsPath(taskId: string, notesDir = getNotesDir()): string {
  if (!isValidTaskAgentTaskId(taskId)) throw new Error(`Invalid task id: ${taskId}`);
  return path.join(taskAgentRunsDir(notesDir), `${taskId}.json`);
}

function indexPath(notesDir = getNotesDir()): string {
  return path.join(taskAgentRunsDir(notesDir), "_index.json");
}

function emptyFile(taskId: string): TaskAgentRunsFile {
  return { version: 1, taskId, handoff: "", runs: [] };
}

function nowIso(d = new Date()): string {
  return d.toISOString();
}

function readFile(taskId: string, notesDir = getNotesDir()): TaskAgentRunsFile {
  const file = safeReadJSON<TaskAgentRunsFile>(taskAgentRunsPath(taskId, notesDir), emptyFile(taskId));
  return {
    version: 1,
    taskId,
    handoff: typeof file.handoff === "string" ? file.handoff : "",
    handoffUpdatedAt: file.handoffUpdatedAt,
    runs: Array.isArray(file.runs) ? file.runs : [],
  };
}

/** Caller must already hold the per-task-file mutex (or be sole writer). */
async function writeFileUnlocked(data: TaskAgentRunsFile, notesDir = getNotesDir()): Promise<TaskAgentRunsFile> {
  const file = taskAgentRunsPath(data.taskId, notesDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeAtomic(file, JSON.stringify(data, null, 2));
  return data;
}

function readIndex(notesDir = getNotesDir()): RunIndexFile {
  const raw = safeReadJSON<RunIndexFile>(indexPath(notesDir), EMPTY_INDEX);
  return { version: 1, byRunId: raw.byRunId && typeof raw.byRunId === "object" ? raw.byRunId : {} };
}

async function indexRun(runId: string, taskId: string, notesDir = getNotesDir()): Promise<void> {
  const file = indexPath(notesDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  await withMutex(file, async () => {
    const index = readIndex(notesDir);
    if (index.byRunId[runId] === taskId) return;
    index.byRunId[runId] = taskId;
    await writeAtomic(file, JSON.stringify(index, null, 2));
  });
}

export function getTaskAgentRuns(taskId: string, notesDir = getNotesDir()): TaskAgentRunsFile {
  if (!isValidTaskAgentTaskId(taskId)) throw new Error(`Invalid task id: ${taskId}`);
  return readFile(taskId, notesDir);
}

export function listTaskAgentRuns(taskId: string, notesDir = getNotesDir()): TaskAgentRunRecord[] {
  return getTaskAgentRuns(taskId, notesDir).runs.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getTaskAgentHandoff(taskId: string, notesDir = getNotesDir()): {
  taskId: string;
  handoff: string;
  handoffUpdatedAt?: string;
  latestRun: TaskAgentRunRecord | null;
} {
  const file = getTaskAgentRuns(taskId, notesDir);
  const latestRun = listTaskAgentRuns(taskId, notesDir)[0] ?? null;
  return {
    taskId,
    handoff: file.handoff,
    handoffUpdatedAt: file.handoffUpdatedAt,
    latestRun,
  };
}

/** Watcher-owned fields; set through patchTaskAgentRun, not upsert. */
export type TaskAgentRunPatch = Partial<
  Pick<
    TaskAgentRunRecord,
    "prUrl" | "branch" | "cwd" | "prState" | "prCheckedAt" | "prSeenAt" | "attention" | "attentionHandled"
  >
>;

/**
 * Patch fields on an existing run record. `undefined` values delete the field.
 * Returns null when the run is not on the task. No write (and no updatedAt
 * bump) when nothing changed — see the note in upsertTaskAgentRun.
 */
export async function patchTaskAgentRun(
  taskId: string,
  runId: string,
  patch: TaskAgentRunPatch,
  notesDir = getNotesDir(),
): Promise<TaskAgentRunRecord | null> {
  const file = taskAgentRunsPath(taskId, notesDir);
  return withMutex(file, async () => {
    const current = readFile(taskId, notesDir);
    const idx = current.runs.findIndex((r) => r.runId === runId);
    if (idx === -1) return null;
    const next: TaskAgentRunRecord = { ...current.runs[idx]! };
    for (const [key, value] of Object.entries(patch) as Array<[keyof TaskAgentRunPatch, unknown]>) {
      if (value === undefined) delete next[key];
      else (next as unknown as Record<string, unknown>)[key] = value;
    }
    if (JSON.stringify(next) === JSON.stringify(current.runs[idx])) return next;
    current.runs[idx] = next;
    await writeFileUnlocked(current, notesDir);
    return next;
  });
}

/**
 * Rollover gives a task a new id each day; move its run history along so the
 * Running / Resume state survives the night. Merges when both ids have files.
 */
export async function relinkTaskAgentRuns(fromId: string, toId: string, notesDir = getNotesDir()): Promise<boolean> {
  if (fromId === toId || !isValidTaskAgentTaskId(fromId) || !isValidTaskAgentTaskId(toId)) return false;
  const fromPath = taskAgentRunsPath(fromId, notesDir);
  if (!fs.existsSync(fromPath)) return false;
  const toPath = taskAgentRunsPath(toId, notesDir);
  const moved = await withMutex(toPath, async () => {
    const from = readFile(fromId, notesDir);
    const to = readFile(toId, notesDir);
    const known = new Set(to.runs.map((r) => r.runId));
    const merged: TaskAgentRunsFile = {
      version: 1,
      taskId: toId,
      handoff: mergeHandoff(from.handoff, to.handoff, "append").handoff,
      handoffUpdatedAt: to.handoffUpdatedAt ?? from.handoffUpdatedAt,
      runs: [...to.runs, ...from.runs.filter((r) => !known.has(r.runId))],
    };
    await writeFileUnlocked(merged, notesDir);
    fs.rmSync(fromPath, { force: true });
    return merged.runs.map((r) => r.runId);
  });
  const index = indexPath(notesDir);
  await withMutex(index, async () => {
    const current = readIndex(notesDir);
    for (const runId of moved) current.byRunId[runId] = toId;
    await writeAtomic(index, JSON.stringify(current, null, 2));
  });
  return true;
}

/** `GET /api/tasks/agent-runs/summary` body, keyed by task id. */
export type TaskAgentRunSummaries = Record<string, { handoff: string; latestRun: TaskAgentRunRecord | null }>;

/** Task ids that have a sidecar — only tasks an agent ever touched. */
export function listTaskAgentRunTaskIds(notesDir = getNotesDir()): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(taskAgentRunsDir(notesDir));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json") && name !== "_index.json")
    .map((name) => name.slice(0, -".json".length))
    .filter(isValidTaskAgentTaskId);
}

export type HandoffUpdateMode = "replace" | "append";

/**
 * Update handoff markdown. `replace` (default) overwrites; `append` joins with
 * a blank line when both sides are non-empty (skips no-op when already ends
 * with the same chunk).
 */
export function mergeHandoff(
  existing: string,
  next: string,
  mode: HandoffUpdateMode = "replace",
): { handoff: string; changed: boolean } {
  const incoming = next.replace(/\r\n/g, "\n");
  if (mode === "replace") {
    return { handoff: incoming, changed: existing !== incoming };
  }
  const trimmed = incoming.trim();
  if (!trimmed) return { handoff: existing, changed: false };
  if (!existing.trim()) return { handoff: incoming, changed: existing !== incoming };
  if (existing.endsWith(trimmed) || existing.includes(`\n\n${trimmed}`)) {
    return { handoff: existing, changed: false };
  }
  const handoff = `${existing.replace(/\s+$/, "")}\n\n${trimmed}`;
  return { handoff, changed: true };
}

export async function setTaskAgentHandoff(
  taskId: string,
  handoff: string,
  opts: { mode?: HandoffUpdateMode; notesDir?: string } = {},
): Promise<TaskAgentRunsFile> {
  if (!isValidTaskAgentTaskId(taskId)) throw new Error(`Invalid task id: ${taskId}`);
  if (handoff.length > MAX_HANDOFF_CHARS) {
    throw new Error(`handoff exceeds ${MAX_HANDOFF_CHARS} characters`);
  }
  const notesDir = opts.notesDir ?? getNotesDir();
  const file = taskAgentRunsPath(taskId, notesDir);
  return withMutex(file, async () => {
    const current = readFile(taskId, notesDir);
    const { handoff: merged, changed } = mergeHandoff(current.handoff, handoff, opts.mode ?? "replace");
    if (!changed) return current;
    return writeFileUnlocked(
      {
        ...current,
        handoff: merged,
        handoffUpdatedAt: nowIso(),
      },
      notesDir,
    );
  });
}

export interface UpsertTaskAgentRunInput {
  taskId: string;
  runId: string;
  status?: TaskAgentRunStatus;
  provider?: string;
  prUrl?: string | null;
  branch?: string | null;
  sessionId?: string | null;
  terminalSessionId?: string | null;
  startedAt?: string;
  /** When set, also updates handoff (replace unless mode is append). */
  handoff?: string;
  handoffMode?: HandoffUpdateMode;
  notesDir?: string;
}

function applyOptionalString(
  target: TaskAgentRunRecord,
  key: "prUrl" | "branch" | "sessionId" | "terminalSessionId" | "provider",
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null || value === "") {
    delete target[key];
    return;
  }
  target[key] = value;
}

/** Create or update a run link on the task sidecar. */
export async function upsertTaskAgentRun(input: UpsertTaskAgentRunInput): Promise<TaskAgentRunsFile> {
  const { taskId, runId } = input;
  if (!isValidTaskAgentTaskId(taskId)) throw new Error(`Invalid task id: ${taskId}`);
  if (!isValidTaskAgentRunId(runId)) throw new Error(`Invalid run id: ${runId}`);
  if (input.status && !isTaskAgentRunStatus(input.status)) {
    throw new Error(`Invalid status: ${input.status}`);
  }
  if (input.handoff !== undefined && input.handoff.length > MAX_HANDOFF_CHARS) {
    throw new Error(`handoff exceeds ${MAX_HANDOFF_CHARS} characters`);
  }
  const notesDir = input.notesDir ?? getNotesDir();
  const file = taskAgentRunsPath(taskId, notesDir);
  const updated = await withMutex(file, async () => {
    const current = readFile(taskId, notesDir);
    const before = JSON.stringify(current);
    const stamp = nowIso();
    const idx = current.runs.findIndex((r) => r.runId === runId);
    if (idx === -1) {
      const record: TaskAgentRunRecord = {
        runId,
        status: input.status ?? "queued",
        startedAt: input.startedAt ?? stamp,
        updatedAt: stamp,
      };
      applyOptionalString(record, "provider", input.provider);
      applyOptionalString(record, "prUrl", input.prUrl);
      applyOptionalString(record, "branch", input.branch);
      applyOptionalString(record, "sessionId", input.sessionId);
      applyOptionalString(record, "terminalSessionId", input.terminalSessionId);
      current.runs.push(record);
    } else {
      const prev = current.runs[idx]!;
      const next: TaskAgentRunRecord = {
        ...prev,
        status: input.status ?? prev.status,
        startedAt: input.startedAt ?? prev.startedAt,
      };
      applyOptionalString(next, "provider", input.provider ?? prev.provider);
      applyOptionalString(next, "prUrl", input.prUrl === undefined ? prev.prUrl : input.prUrl);
      applyOptionalString(next, "branch", input.branch === undefined ? prev.branch : input.branch);
      applyOptionalString(next, "sessionId", input.sessionId === undefined ? prev.sessionId : input.sessionId);
      applyOptionalString(
        next,
        "terminalSessionId",
        input.terminalSessionId === undefined ? prev.terminalSessionId : input.terminalSessionId,
      );
      current.runs[idx] = next;
    }

    if (input.handoff !== undefined) {
      const { handoff, changed } = mergeHandoff(current.handoff, input.handoff, input.handoffMode ?? "replace");
      if (changed) {
        current.handoff = handoff;
        current.handoffUpdatedAt = stamp;
      }
    }

    // readAgentRun heals finished runs on every read; an unchanged sync must not
    // bump updatedAt, or merely viewing an old run makes it the task's "latest".
    if (JSON.stringify(current) === before) return current;
    if (idx !== -1) current.runs[idx]!.updatedAt = stamp;
    return writeFileUnlocked(current, notesDir);
  });
  await indexRun(runId, taskId, notesDir);
  return updated;
}

/**
 * Update status (and optional session fields) for a run known to the index.
 * No-op when the run is not linked to a task.
 */
export async function syncTaskAgentRunFromAgentState(
  runId: string,
  agentState: AgentRunState,
  extras: {
    sessionId?: string | null;
    terminalSessionId?: string | null;
    provider?: string;
    notesDir?: string;
  } = {},
): Promise<TaskAgentRunsFile | null> {
  if (!isValidTaskAgentRunId(runId)) return null;
  const notesDir = extras.notesDir ?? getNotesDir();
  const taskId = readIndex(notesDir).byRunId[runId];
  if (!taskId) return null;
  return upsertTaskAgentRun({
    taskId,
    runId,
    status: mapAgentRunStateToTaskStatus(agentState),
    sessionId: extras.sessionId,
    terminalSessionId: extras.terminalSessionId,
    provider: extras.provider,
    notesDir,
  });
}

export function lookupTaskIdForRun(runId: string, notesDir = getNotesDir()): string | null {
  if (!isValidTaskAgentRunId(runId)) return null;
  return readIndex(notesDir).byRunId[runId] ?? null;
}
