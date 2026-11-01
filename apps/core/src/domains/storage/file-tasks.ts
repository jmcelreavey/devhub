import * as tasks from "../tasks/store.ts";
import { TaskConflictError, type TaskExpectation, type TaskStorage, type TaskStorageSession } from "../../../../../packages/shared/storage/contracts.ts";

/** Keeps the legacy file formats and process-local queue until SQLite cutover. */
export function createFileTaskStorage(tasksDir: string): TaskStorage {
  function checkExpected(id: string, expected?: TaskExpectation): void {
    if (!expected) return;
    tasks.invalidateTaskCache(tasksDir);
    const current = tasks.findTask(tasksDir, id);
    if (!current || current.createdAt !== expected.createdAt || current.text !== expected.text) {
      throw new TaskConflictError();
    }
  }

  const session: TaskStorageSession = {
    async list(options) {
      if (options?.fresh) tasks.invalidateTaskCache(tasksDir);
      return tasks.readItems(tasksDir);
    },
    async find(id) { return tasks.findTask(tasksDir, id); },
    async readErrors() { return tasks.itemReadErrors(tasksDir); },
    async onDay(day, today) { return tasks.tasksOnDay(tasksDir, day, today); },
    async listOpen(today) { return tasks.listOpenTasks(tasksDir, today); },
    async listDays(today) { return tasks.listDays(tasksDir, today); },
    async create(input, now) {
      return tasks.createTask(tasksDir, input, now);
    },
    async patch(id, patch, now, expected) {
      checkExpected(id, expected);
      return tasks.patchTask(tasksDir, id, patch, now);
    },
    async delete(id, expected) {
      checkExpected(id, expected);
      return tasks.deleteTask(tasksDir, id);
    },
    async reorder(orderedIds, day, today) {
      return tasks.reorderOpenTasks(tasksDir, orderedIds, day, today);
    },
    async startTimer(id, now) {
      return tasks.startTimer(tasksDir, id, now);
    },
    async stopTimer(id, now) {
      return tasks.stopTimer(tasksDir, id, now);
    },
  };

  function locked<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
    return (...args: Args): Promise<Result> => tasks.withTaskLock(tasksDir, () => operation(...args));
  }

  return {
    ...session,
    create: locked(session.create),
    patch: locked(session.patch),
    delete: locked(session.delete),
    reorder: locked(session.reorder),
    startTimer: locked(session.startTimer),
    stopTimer: locked(session.stopTimer),
    withWriteLock: (operation) => tasks.withTaskLock(tasksDir, () => operation(session)),
  };
}
