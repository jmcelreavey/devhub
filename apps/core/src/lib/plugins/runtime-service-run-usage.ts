import fs from "node:fs";
import path from "node:path";
import { NotesStorage } from "../../domains/storage/notes";
import { sqlitePeekRun, sqliteRunsEnabled } from "../../domains/storage/runs";
import { sqliteDatabasePath } from "../../domains/storage/sqlite";
import { taskAgentRunsPath } from "../../domains/tasks/task-agent-runs";
import { blocksToText } from "../../../../../packages/shared/markdown-convert/index.ts";
import { isTaskOwnershipBlocked, type Task } from "../../../../../packages/shared/tasks/types.ts";
import type { AgentRunSpec, AgentRunStatus, RecordedAgentRunEvent } from "../../../../../packages/shared/agent-runs/contracts.ts";
import { agentRunDir, agentRunsDir } from "../agent-runs/store";
import { taskScopeForDirectory } from "../agent-runs/run-files";
import { getNotesDir } from "../content/dirs";
import type { RunUsage } from "../storyboard/notes-board";
import { assertSafePath } from "./filesystem";

function readJson<T>(file: string): T | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Never reconciles, imports, or updates the linked task or agent run. */
export function serviceRunUsage(task: Task, directory: string, profile: string, runId: string, current: () => boolean): RunUsage | null {
  if (!current()) throw new Error("Service authorisation or active task profile changed");
  if (isTaskOwnershipBlocked(task)) return null;
  const configured = getNotesDir();
  const notes = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
  const sidecar = taskAgentRunsPath(task.id, notes);
  assertSafePath(notes, sidecar);
  const file = readJson<{ runs?: Array<{ runId?: string }> }>(sidecar);
  if (!Array.isArray(file?.runs) || !file.runs.some((entry) => entry?.runId === runId)) return null;
  const runDir = agentRunDir(runId);
  if (!runDir) return null;
  for (const name of ["spec.json", "status.json", "events.jsonl"]) assertSafePath(agentRunsDir(), path.join(runDir, name));
  let snapshot: { spec: AgentRunSpec; status: AgentRunStatus; events: RecordedAgentRunEvent[]; incompleteEvents: boolean } | null = null;
  if (sqliteRunsEnabled()) {
    const db = sqliteDatabasePath();
    assertSafePath(path.dirname(db), db);
    snapshot = sqlitePeekRun(runDir);
  }
  if (!sqliteRunsEnabled()) {
    const spec = readJson<AgentRunSpec>(path.join(runDir, "spec.json"));
    const status = readJson<AgentRunStatus>(path.join(runDir, "status.json"));
    if (!spec || !status) return null;
    let events: RecordedAgentRunEvent[] = [];
    let incompleteEvents = false;
    const eventsFile = path.join(runDir, "events.jsonl");
    try {
      const stat = fs.lstatSync(eventsFile);
      if (stat.isFile() && stat.size <= 4 * 1024 * 1024) events = fs.readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).slice(-30).flatMap((line) => {
        try { return [JSON.parse(line) as RecordedAgentRunEvent]; } catch { incompleteEvents = true; return []; }
      });
      else incompleteEvents = true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    snapshot = { spec, status, events, incompleteEvents };
  }
  if (!snapshot) return null;
  const { spec, status, events, incompleteEvents } = snapshot;
  const expected = taskScopeForDirectory(profile, directory, task.id, task.createdAt);
  const scope = spec.activity?.taskScope;
  if (spec.id !== runId || spec.activity?.taskId !== task.id || !expected || !scope || scope.profile !== expected.profile || scope.directoryIdentity !== expected.directoryIdentity || scope.taskCreatedAt !== expected.taskCreatedAt) return null;
  if ((status.state === "failed" && !status.error && incompleteEvents) || (status.error?.length ?? 0) > 60_000 || (status.resultText?.length ?? 0) > 60_000) return null;
  const lastError = status.state === "failed" && !status.error ? events.filter((event) => event.type === "error" || event.type === "stderr" || (event.type === "result" && !event.ok)).at(-1) : undefined;
  const reviewPath = spec.activity?.action === "review" ? spec.activity.notePath ?? spec.prompt?.match(/Save the review as the DevHub note (pr-reviews\/[A-Za-z0-9_/-]+)/)?.[1] : undefined;
  let reviewText: string | undefined;
  if (reviewPath && /^pr-reviews\/[A-Za-z0-9_/-]+$/.test(reviewPath) && !reviewPath.includes("..")) {
    assertSafePath(notes, path.join(notes, reviewPath + ".json"));
    const review = new NotesStorage(notes).read(reviewPath);
    if (review && Array.isArray(review.content)) reviewText = blocksToText(review.content);
    if ((reviewText?.length ?? 0) > 60_000) return null;
  }
  if (!current()) throw new Error("Service authorisation or active task profile changed");
  assertSafePath(directory, path.join(directory, "items", task.id + ".json"));
  const latestTask = readJson<Task>(path.join(directory, "items", task.id + ".json"));
  if (!latestTask || latestTask.id !== task.id || latestTask.createdAt !== task.createdAt || isTaskOwnershipBlocked(latestTask)) return null;
  const error = status.error || (lastError?.type === "error" ? lastError.message : lastError && "text" in lastError ? lastError.text : undefined);
  if ((error?.length ?? 0) > 60_000) return null;
  return { stateChangedAt: status.finishedAt ?? status.updatedAt, costUsd: status.costUsd, inputTokens: status.inputTokens, outputTokens: status.outputTokens, error, exitCode: status.exitCode, resultText: status.resultText, reviewText };
}

export function serviceLinkedRuns(task: Task, notes: string): string[] {
  const file = taskAgentRunsPath(task.id, notes);
  assertSafePath(notes, file);
  const sidecar = readJson<{ runs?: Array<{ runId?: unknown }> }>(file);
  return Array.isArray(sidecar?.runs) ? sidecar.runs.flatMap((run) => typeof run?.runId === "string" ? [run.runId] : []) : [];
}
