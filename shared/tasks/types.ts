import type { EntityRef } from "../entity-note/index.ts";

export type { EntityRef };

export interface Task {
  /** Stable across daily history snapshots. */
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
  timeSpentMs?: number;
  timerStartedAt?: string;
  /** Legacy alias from when rollover created a new UUID each day. */
  rolledFromId?: string;
  rolledFromDate?: string;
  /** Canonical companion note; its original filename need not match today's date. */
  notePath?: string;
  links?: EntityRef[];
  /** Absent = ready; draft = captured idea that still needs a plan. */
  stage?: TaskStage;
}

export type TaskStage = "draft";

export function isTaskOpen(task: Task): boolean {
  return !task.done && !task.abandonedAt && !task.movedAt;
}

export function isTaskReadyForAgent(task: Task): boolean {
  return isTaskOpen(task) && task.stage !== "draft";
}
