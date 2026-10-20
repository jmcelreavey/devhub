import path from "node:path";
import type { TaskNoteStatus } from "@shared/task-note/meta.ts";
import { getActiveTasksDir } from "@/lib/notes/dir";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { reopenTask, resolveReopenTask } from "@/lib/tasks/reopen-task";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { readNotesBoard } from "./notes-board";
import { isBackwardMove, moveRequiresConfirmation } from "./notes-board-shared";
import { activeTaskRuns, stopTaskWork } from "./stop-task-work";
import { StoryboardError } from "./errors";

export async function moveTaskCard(input: { taskId: string; status: TaskNoteStatus; stopActive?: boolean }) {
  const task = await resolveReopenTask(input.taskId);
  return withPluginMutationLock(path.join(getActiveTasksDir(), ".locks", `move-${task.id}`), async () => {
    const card = readNotesBoard({ doneWindowDays: null }).cards.find((item) => item.taskId === task.id);
    if (!card) throw new StoryboardError("Task not found on the board.", 404);
    if (card.status === input.status) return { ok: true };
    const backward = isBackwardMove(card.status, input.status);
    const runs = activeTaskRuns(task.id);
    if ((moveRequiresConfirmation(card, input.status) || backward && runs.length > 0) && !input.stopActive) return { ok: false, requiresConfirmation: true };
    if (backward) await stopTaskWork(task.id, runs);
    if (task.done || task.abandonedAt || card.status === "done") await reopenTask({ taskId: task.id, reason: `Moved to ${input.status}` });
    updateTaskNoteSections({ taskId: task.id, date: task.startDate }, { op: "set_status", status: input.status });
    return { ok: true };
  });
}
