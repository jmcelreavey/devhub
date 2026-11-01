import type { DayBucket, NewTaskInput, TaskPatch } from "../tasks/storage-contracts.ts";
import type { Task } from "../tasks/types.ts";

export type { DayBucket, NewTaskInput, TaskPatch } from "../tasks/storage-contracts.ts";

/** Identity and content the caller saw; checked within the mutation's lock. */
export interface TaskExpectation {
  createdAt: string;
  text: string;
}

export class TaskConflictError extends Error {
  constructor() {
    super("The task changed. Refresh before trying again.");
    this.name = "TaskConflictError";
  }
}

/** One task scope, selected by the caller. Migration and note writes stay outside this port. */
export interface TaskStorageSession {
  list(options?: { fresh?: boolean }): Promise<Task[]>;
  find(id: string): Promise<Task | null>;
  readErrors(): Promise<string[]>;
  onDay(day: string, today?: string): Promise<Task[]>;
  listOpen(today?: string): Promise<Task[]>;
  listDays(today?: string): Promise<DayBucket[]>;
  create(input: NewTaskInput, now?: Date): Promise<Task>;
  patch(id: string, patch: TaskPatch, now?: Date, expected?: TaskExpectation): Promise<Task | null>;
  delete(id: string, expected?: TaskExpectation): Promise<boolean>;
  reorder(orderedIds: readonly string[], day: string, today?: string): Promise<Task[]>;
  startTimer(id: string, now?: Date): Promise<Task | null>;
  stopTimer(id: string, now?: Date): Promise<Task | null>;
}

export interface TaskStorage extends TaskStorageSession {
  /** Coordinates compound checks and writes; the file backend does not provide rollback. */
  withWriteLock<T>(operation: (storage: TaskStorageSession) => Promise<T>): Promise<T>;
}
