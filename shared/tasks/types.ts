import type { EntityRef } from "../entity-note/index.ts";

export type { EntityRef };

/**
 * One task, stored once. It is on day D when `startDate <= D <= (endDate ?? today)`.
 * `endDate` is set only when the task is done or abandoned; reactivating clears it.
 * `rank` is a lexicographic sort key so a reorder rewrites the moved task only.
 */
export interface Task {
  id: string;
  text: string;
  done: boolean;
  /** Day the task was created or planned for (YYYY-MM-DD). */
  startDate: string;
  /** Day the task finished (done, abandoned, or ended by a legacy move). Absent while open. */
  endDate?: string;
  /** Why a non-done, non-abandoned task has an endDate. */
  endReason?: "legacy-moved";
  /** Fractional index. Sort ascending. */
  rank: string;
  /**
   * Latest legacy day-file incorporated into this item.
   * Used once to baseline older items without content digests.
   */
  legacyThrough?: string;
  legacyDigest?: string;
  legacyRowDigests?: Record<string, string>;
  jiraKey?: string;
  due?: string;
  createdAt: string;
  completedAt?: string;
  abandonedAt?: string;
  abandonReason?: string;
  timeSpentMs?: number;
  /** Machine-local. Never written to the synced item file. */
  timerStartedAt?: string;
  /** Canonical companion note. */
  notePath?: string;
  links?: EntityRef[];
  /** Absent = ready; draft = captured idea that still needs a plan. */
  stage?: TaskStage;
  /** Every legacy day-file id that collapsed into this item, sorted. */
  legacyIds?: string[];
  /** @deprecated Day-file rollover. Not written on items. */
  movedAt?: string;
  /** @deprecated Day-file rollover. Not written on items. */
  movedToDate?: string;
  /** @deprecated Old UUID rollover. Not written on items. */
  rolledFromId?: string;
  /** @deprecated Old UUID rollover. Not written on items. */
  rolledFromDate?: string;
}

export type TaskStage = "draft";

export function isTaskOpen(task: Task): boolean {
  return !task.done && !task.abandonedAt && !task.endDate;
}

export function isTaskReadyForAgent(task: Task): boolean {
  return isTaskOpen(task) && task.stage !== "draft";
}
