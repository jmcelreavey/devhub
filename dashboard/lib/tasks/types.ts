/**
 * The canonical Task shape, shared by server storage and client components.
 *
 * This exists because there were two of them. `lib/tasks/storage.ts` owned one
 * but imports `node:fs`, so no client component could reach it — and a copy had
 * been made in `components/TaskList.tsx` instead. The copy then drifted: it was
 * missing `rolledFromId` and `rolledFromDate`, the fields rollover writes, so
 * client code literally could not see where a rolled-over task came from.
 *
 * A types-only module has no runtime imports, so both sides can depend on it
 * and the shapes cannot diverge again.
 */
import type { EntityRef } from "@/lib/entity-note";

export type { EntityRef };

export interface Task {
  id: string;
  text: string;
  done: boolean;
  jiraKey?: string;
  due?: string;
  createdAt: string;
  completedAt?: string;
  abandonedAt?: string;
  abandonReason?: string;
  movedAt?: string;
  movedToDate?: string;
  /** Committed time spent on the task, in ms. */
  timeSpentMs?: number;
  /** ISO timestamp the running timer started; absent when no timer is running. */
  timerStartedAt?: string;
  /** Source task id when this row was created by rollover (idempotency on crash/retry). */
  rolledFromId?: string;
  /** Source date when this row was created by rollover. */
  rolledFromDate?: string;
  /**
   * Hop-around edges (PR, calendar, note, …) that don't live only in a note body.
   * Same EntityRef contract as note ## Links / MCP / plugins.
   */
  links?: EntityRef[];
}

/**
 * Open = not finished, not abandoned, not moved to another day.
 *
 * Pure and dependency-free so both the storage layer and the UI can agree on
 * what "open" means; they previously each had their own copy of this too.
 */
export function isTaskOpen(task: Task): boolean {
  return !task.done && !task.abandonedAt && !task.movedAt;
}
