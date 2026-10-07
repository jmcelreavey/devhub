import fs from "node:fs";
import path from "node:path";
import { getNotesDir, getTasksDir } from "@/lib/content/dirs";
import { safeReadJSON } from "@/lib/atomic-write";
import { resolveStoredTaskNotes } from "@shared/task-note/resolve";
import type { Task } from "./types";

/** One cache per read operation, so a day's tasks can share their ancestry reads. */
export function createTaskNoteResolver() {
  const tasksDir = getTasksDir();
  const notesDir = getNotesDir();
  const days = new Map<string, Task[]>();
  return (task: Task, date: string) => resolveStoredTaskNotes(task, date, {
    readTask: (sourceDate, id) => {
      let tasks = days.get(sourceDate);
      if (!tasks) {
        tasks = safeReadJSON<Task[]>(path.join(tasksDir, `${sourceDate}.json`), []);
        days.set(sourceDate, tasks);
      }
      return tasks.find((t) => t.id === id);
    },
    noteExists: (notePath) => fs.existsSync(path.join(notesDir, `${notePath}.json`)),
  });
}

export function resolveTaskNotePath(task: Task, date: string): string {
  return createTaskNoteResolver()(task, date).notePath;
}
