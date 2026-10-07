import type { Task } from "../tasks/types.ts";
import { taskNotePath } from "./index.ts";

export interface TaskNoteLookup {
  readTask: (date: string, id: string) => Task | undefined;
  noteExists: (notePath: string) => boolean;
}

export interface TaskNoteResolution {
  notePath: string;
  previousNotePaths: string[];
}

/** Reuse legacy plans in place; never copy or rewrite their rich note content. */
export function resolveStoredTaskNotes(
  task: Task,
  date: string,
  lookup: TaskNoteLookup,
): TaskNoteResolution {
  const candidates = new Set<string>();
  const visited = new Set<string>();
  let current: Task | undefined = task;
  let currentDate = date;

  while (current) {
    const key = `${currentDate}:${current.id}`;
    if (visited.has(key)) break;
    visited.add(key);
    candidates.add(taskNotePath({ ...current, date: currentDate }));
    candidates.add(taskNotePath({ ...current, date: currentDate, notePath: undefined }));
    if (!current.rolledFromId || !/^\d{4}-\d{2}-\d{2}$/.test(current.rolledFromDate ?? "")) break;
    currentDate = current.rolledFromDate!;
    current = lookup.readTask(currentDate, current.rolledFromId);
  }

  const paths = [...candidates];
  const existing = paths.filter(lookup.noteExists);
  const notePath = task.notePath
    ? taskNotePath({ ...task, date })
    : existing[0] ?? paths[paths.length - 1]!;
  return { notePath, previousNotePaths: existing.filter((p) => p !== notePath) };
}
