import fs from "node:fs";
import path from "node:path";
import { getActiveTasksDir, getNotesDir } from "@/lib/content/dirs";
import { readItems } from "@shared/tasks/store.ts";
import { resolveStoredTaskNotes } from "@shared/task-note/resolve";
import type { Task } from "./types";

/** One cache per read operation, so a day's tasks can share their ancestry reads. */
export function createTaskNoteResolver() {
  const tasksDir = getActiveTasksDir();
  const notesDir = getNotesDir();
  return (task: Task, date: string) => resolveStoredTaskNotes(task, date, {
    readTask: (_sourceDate, id) => readItems(tasksDir).find((item) => item.id === id || item.legacyIds?.includes(id)),
    noteExists: (notePath) => fs.existsSync(path.join(notesDir, `${notePath}.json`)),
  });
}

export function resolveTaskNotePath(task: Task, date: string): string {
  return createTaskNoteResolver()(task, date).notePath;
}
