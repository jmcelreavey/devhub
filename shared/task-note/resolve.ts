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

function pathFor(task: Task, date: string): string | undefined {
  try {
    return taskNotePath({ ...task, date, notePath: undefined });
  } catch {
    return undefined;
  }
}

/** Reuse legacy plans in place; never copy or rewrite their rich note content. */
export function resolveStoredTaskNotes(
  task: Task,
  date: string,
  lookup: TaskNoteLookup,
): TaskNoteResolution {
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  add(pathFor(task, date));
  const visited = new Set<string>();
  let current: Task | undefined = task;
  let currentDate = date;
  while (current?.rolledFromId) {
    const fromDate = current.rolledFromDate;
    if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) break;
    const key = `${currentDate}:${current.id}`;
    if (visited.has(key)) break;
    visited.add(key);
    currentDate = fromDate;
    const previous = lookup.readTask(currentDate, current.rolledFromId);
    if (!previous) break;
    add(pathFor(previous, currentDate));
    current = previous;
  }
  if (task.startDate && task.startDate !== date) add(pathFor(task, task.startDate));
  for (const legacyId of task.legacyIds ?? []) {
    if (legacyId === task.id) continue;
    add(pathFor({ ...task, id: legacyId }, task.startDate || date));
    if (date !== task.startDate) add(pathFor({ ...task, id: legacyId }, date));
  }

  const existing = candidates.filter((candidate) => lookup.noteExists(candidate));
  const stored = task.notePath && lookup.noteExists(task.notePath) ? task.notePath : undefined;
  const notePath = stored ?? existing[0] ?? task.notePath ?? candidates[candidates.length - 1] ?? pathFor(task, date) ?? `task-notes/${date}-${task.id}`;
  return { notePath, previousNotePaths: existing.filter((candidate) => candidate !== notePath) };
}
