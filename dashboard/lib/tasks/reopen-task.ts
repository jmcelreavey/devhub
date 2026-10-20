import path from "node:path";
import { readItems } from "@shared/tasks/store.ts";
import { taskMatchesId } from "@shared/tasks/view.ts";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import type { TaskNoteStatus } from "@shared/task-note/meta.ts";
import { getActiveTasksDir } from "@/lib/notes/dir";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { StoryboardError } from "@/lib/storyboard/errors";
import { mutateOrchestration, readOrchestration } from "@/lib/storyboard/orchestration-store";
import { activeTaskProfile, withTaskProfileRequest } from "./profile-request";
import type { Task } from "./types";
import { ensureTasksMigrated, reactivateTask } from "./storage";
import { listTaskAgentRuns } from "./task-agent-runs";
import { TaskNoteNotFoundError, updateTaskNoteSections } from "./task-note-sections";

export interface ReopenTaskInput {
  taskId: string;
  date?: string;
  reason?: string;
  profile?: string;
}

export interface ReopenTaskResult {
  ok: true;
  alreadyOpen: boolean;
  column: TaskNoteStatus;
  task: Task;
}

export async function resolveReopenTask(taskId: string) {
  await ensureTasksMigrated();
  const matches = readItems(getActiveTasksDir()).filter((task) => taskMatchesId(task, taskId) || task.jiraKey?.toLowerCase() === taskId.toLowerCase());
  if (!matches.length) throw new StoryboardError("Task not found in this profile.", 404);
  if (matches.length > 1) throw new StoryboardError("Several tasks match that ticket. Use the task ID.", 409);
  return matches[0];
}

export async function reopenTask(input: ReopenTaskInput): Promise<ReopenTaskResult> {
  if (input.profile !== undefined) {
    if (input.profile !== activeTaskProfile()) throw new StoryboardError("The active task profile changed. Refresh before continuing.", 409);
    return withTaskProfileRequest(input.profile, () => reopenTask({ ...input, profile: undefined }));
  }
  const task = await resolveReopenTask(input.taskId);
  return withPluginMutationLock(path.join(getActiveTasksDir(), ".locks", `reopen-${task.id}`), async () => {
    const current = await resolveReopenTask(task.id);
    if (isTaskOwnershipBlocked(current)) throw new StoryboardError("This task's ownership is pending or handed off and is read-only.", 409);
    const runs = listTaskAgentRuns(task.id);
    const target = { taskId: task.id, date: input.date ?? task.startDate };
    const hasWork = current.links?.some((link) => link.kind === "pr") || runs.some((run) => run.prUrl || run.branch);
    const column: TaskNoteStatus = hasWork ? "ready-for-review" : "in-progress";
    let note: ReturnType<typeof updateTaskNoteSections> | null = null;
    try { note = updateTaskNoteSections(target, { op: "read" }); }
    catch (error) { if (!(error instanceof TaskNoteNotFoundError)) throw error; }
    if (!current.done && !current.abandonedAt && !current.endDate && note?.view.meta?.status !== "done") return { ok: true as const, alreadyOpen: true, column, task: current };
    const now = new Date();
    const withPr: TaskNoteStatus = note?.view.meta?.links?.some((link) => link.kind === "pr") ? "ready-for-review" : column;
    if (readOrchestration(task.id)) await mutateOrchestration(task.id, null, (record) => record ? { ...record, status: "paused-manual" } : null);
    updateTaskNoteSections(target, { op: "set_status", status: withPr }, now);
    updateTaskNoteSections(target, { op: "append_log", message: reopenLogMessage(input.reason) }, now);
    const reopened = await reactivateTask(task.id, target.date);
    if (!reopened) throw new StoryboardError("Task disappeared while reopening it.", 409);
    return { ok: true as const, alreadyOpen: false, column: withPr, task: reopened };
  });
}

/** The log entry already carries its own time, so the line is just "Reopened" plus the reason. */
export function reopenLogMessage(reason?: string): string {
  const why = reason?.trim().replace(/\s+/g, " ").slice(0, 400);
  return why ? `Reopened — ${why}` : "Reopened";
}
