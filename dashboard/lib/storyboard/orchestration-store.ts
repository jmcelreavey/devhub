import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "@/lib/atomic-write";
import { getNotesDir } from "@/lib/notes/dir";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { OrchestrationRecordSchema, TaskIdSchema } from "./schema";
import { StoryboardError, storyboardDir } from "./errors";
import { ORCHESTRATION_SCHEMA_VERSION, type OrchestrationRecord } from "./types";

/**
 * One orchestration per task in `notes/.config/storyboard/` (small JSON,
 * synced): revisioned, written under a per-task lock, and a corrupt or future-version file is an error — never an
 * empty record that the next write would silently replace.
 */
export function orchestrationsDir(notesDir = getNotesDir()): string {
  return path.join(storyboardDir(notesDir), "orchestrations");
}

function orchestrationPath(taskId: string, notesDir: string): string {
  if (!TaskIdSchema.safeParse(taskId).success) throw new StoryboardError("Invalid task ID", 400);
  return path.join(orchestrationsDir(notesDir), taskId + ".json");
}

export function newOrchestration(input: Pick<OrchestrationRecord, "taskId" | "taskDate">, now = new Date().toISOString()): OrchestrationRecord {
  return {
    schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
    revision: 0,
    ...input,
    executionStep: "plan",
    status: "starting",
    runIds: [],
    questions: [],
    terminal: null,
    createdAt: now,
    updatedAt: now,
    idempotency: [],
  };
}

export function readOrchestration(taskId: string, notesDir = getNotesDir()): OrchestrationRecord | null {
  let raw: string;
  try {
    raw = fs.readFileSync(orchestrationPath(taskId, notesDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let json: { schemaVersion?: unknown };
  try {
    json = JSON.parse(raw) as { schemaVersion?: unknown };
  } catch {
    throw new StoryboardError(`Orchestration ${taskId}.json is not valid JSON. It has not been changed; fix or restore it from git.`, 500);
  }
  if (typeof json.schemaVersion === "number" && json.schemaVersion > ORCHESTRATION_SCHEMA_VERSION) {
    throw new StoryboardError(`Orchestration ${taskId} was written by a newer DevHub (schema ${json.schemaVersion}). Update DevHub first.`, 409);
  }
  const parsed = OrchestrationRecordSchema.safeParse(json);
  if (!parsed.success) throw new StoryboardError(`Orchestration ${taskId}.json is corrupt. It has not been changed; fix or restore it from git.`, 500);
  if (parsed.data.taskId !== taskId) throw new StoryboardError(`Orchestration file ${taskId}.json names another task`, 409);
  return parsed.data as OrchestrationRecord;
}

/** Every orchestration. A corrupt file is reported in `errors`, not hidden and not fatal to the rest. */
export function listOrchestrations(notesDir = getNotesDir()): { records: OrchestrationRecord[]; errors: string[] } {
  let names: string[];
  try {
    names = fs.readdirSync(orchestrationsDir(notesDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], errors: [] };
    throw error;
  }
  const records: OrchestrationRecord[] = [];
  const errors: string[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const taskId = name.slice(0, -5);
    if (!TaskIdSchema.safeParse(taskId).success) continue;
    try {
      const record = readOrchestration(taskId, notesDir);
      if (record) records.push(record);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { records, errors };
}

/** Serialise dispatch/restore against reset without preventing Manual from interrupting a dispatch. */
export function withOrchestrationWorkLock<T>(taskId: string, notesDir: string, work: () => Promise<T>): Promise<T> {
  orchestrationPath(taskId, notesDir);
  return withPluginMutationLock(path.join(storyboardDir(notesDir), ".locks", "work-" + taskId), work);
}

/** Re-entrant so reset can keep the record stable until cancellation and note writes finish. */
export function withOrchestrationMutationLock<T>(taskId: string, notesDir: string, work: () => Promise<T>): Promise<T> {
  orchestrationPath(taskId, notesDir);
  return withPluginMutationLock(path.join(storyboardDir(notesDir), ".locks", "orchestration-" + taskId), work);
}

const MAX_IDEMPOTENCY_RECORDS = 50;

export interface OrchestrationMutation {
  record: OrchestrationRecord;
  /** True when the idempotency key was already applied; nothing changed. */
  replayed: boolean;
  /** True when this call wrote the file for the first time. */
  created: boolean;
}

/**
 * Apply one change under the per-task lock.
 *
 * - `idempotencyKey` replays: a retried request returns the stored record unchanged.
 * - `change` receives the current record (or null) and returns the next one, or
 *   null for "nothing to do" — no revision bump, no write.
 */
export async function mutateOrchestration(
  taskId: string,
  idempotencyKey: string | null,
  change: (current: OrchestrationRecord | null) => OrchestrationRecord | null,
  notesDir = getNotesDir(),
): Promise<OrchestrationMutation> {
  const file = orchestrationPath(taskId, notesDir);
  return withOrchestrationMutationLock(taskId, notesDir, async () => {
    const current = readOrchestration(taskId, notesDir);
    if (current && idempotencyKey && current.idempotency.some((record) => record.key === idempotencyKey)) {
      return { record: current, replayed: true, created: false };
    }
    const next = change(current ? structuredClone(current) : null);
    if (!next) {
      if (!current) throw new StoryboardError("No orchestration for that task.", 404);
      return { record: current, replayed: false, created: false };
    }
    if (next.taskId !== taskId) throw new StoryboardError("An orchestration cannot change task.", 400);
    const now = new Date().toISOString();
    next.revision = (current?.revision ?? 0) + 1;
    next.updatedAt = now;
    if (idempotencyKey) next.idempotency = [...next.idempotency, { key: idempotencyKey, at: now }].slice(-MAX_IDEMPOTENCY_RECORDS);
    const parsed = OrchestrationRecordSchema.parse(next) as OrchestrationRecord;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeAtomic(file, JSON.stringify(parsed, null, 2) + "\n");
    return { record: parsed, replayed: false, created: !current };
  });
}

/** Forget a task's orchestration entirely (Reset to To do). The task, its note and its run history stay. */
export async function deleteOrchestration(taskId: string, notesDir = getNotesDir()): Promise<boolean> {
  const file = orchestrationPath(taskId, notesDir);
  return withOrchestrationMutationLock(taskId, notesDir, async () => {
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file, { force: true });
    return true;
  });
}
