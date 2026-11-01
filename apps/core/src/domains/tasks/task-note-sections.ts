import { createFileContentStorage } from "../../../../../packages/shared/storage/file-content.ts";
import { updateTaskNoteContent } from "../../../../../packages/shared/task-note/content.ts";
import { getNotesDir, getActiveTasksDir } from "../../lib/content/dirs";
import { getStorage } from "../../lib/storage-server";
import { findTask, readItems } from "./store";
import { isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import { buildTaskNoteMarkdown } from "../../../../../packages/shared/task-note/index.ts";
import { TaskNoteOpError } from "../../../../../packages/shared/task-note/sections.ts";
import { TaskNoteNotFoundError, updateTaskNote, type UpdateTaskNoteResult } from "../../../../../packages/shared/task-note/update.ts";
import { textToBlocks } from "../../../../../packages/shared/markdown-convert/index.ts";
import { createTaskNoteResolver } from "./task-notes";

export { TaskNoteNotFoundError, TaskNoteOpError };

export interface TaskNoteTarget {
  notePath?: string;
  taskId?: string;
  date?: string;
}

/**
 * Run one section operation (or `read`) against a task's note.
 * The target is a note path or a task id; with a task id a missing note is
 * created from the task's scaffold so an agent never has to check first.
 */
export function updateTaskNoteSections(target: TaskNoteTarget, fields: { op: "read" }, now?: Date): UpdateTaskNoteResult;
export function updateTaskNoteSections(target: TaskNoteTarget, fields: Record<string, unknown>, now?: Date): UpdateTaskNoteResult | Promise<UpdateTaskNoteResult>;
export function updateTaskNoteSections(
  target: TaskNoteTarget,
  fields: Record<string, unknown>,
  now?: Date,
): UpdateTaskNoteResult | Promise<UpdateTaskNoteResult> {
  let notePath = target.notePath;
  let scaffold: (() => unknown[]) | undefined;
  if (fields.op !== "read") {
    const task = target.taskId ? findTask(getActiveTasksDir(), target.taskId) : readItems(getActiveTasksDir()).find((entry) => createTaskNoteResolver()(entry, entry.startDate).notePath === notePath?.replace(/\.json$/, ""));
    if (isTaskOwnershipBlocked(task)) throw new TaskNoteOpError("This task's ownership is pending or handed off and is read-only.");
  }

  if (!notePath) {
    if (!target.taskId) throw new TaskNoteOpError("notePath or taskId is required");
    const task = findTask(getActiveTasksDir(), target.taskId);
    if (!task) throw new TaskNoteNotFoundError(`Task ${target.taskId} not found`);
    const date = target.date ?? task.startDate;
    notePath = createTaskNoteResolver()(task, date).notePath;
    scaffold = () =>
      textToBlocks(
        buildTaskNoteMarkdown({
          id: task.id,
          text: task.text,
          date,
          jiraKey: task.jiraKey,
          notePath,
          related: task.links,
        }),
      );
  }

  const options = { notesRoot: getNotesDir(), scaffold, now };
  if (fields.op === "read") return updateTaskNote(getStorage(), notePath, fields, options);
  return updateTaskNoteContent(createFileContentStorage(options.notesRoot), notePath, fields, options);
}
