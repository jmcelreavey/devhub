import type { Task } from "./types.ts";
import { daysBetween } from "./dates.ts";

/** Last day a task is shown. Open tasks run through today; a future start is that day only. */
export function effectiveEnd(task: Pick<Task, "startDate" | "endDate">, today: string): string {
  if (task.endDate) return task.endDate;
  return task.startDate > today ? task.startDate : today;
}

export function isVisibleOn(task: Pick<Task, "startDate" | "endDate">, day: string, today: string): boolean {
  if (!task.startDate || task.startDate > day) return false;
  return day <= effectiveEnd(task, today);
}

export function isOpenOn(task: Pick<Task, "endDate" | "done" | "abandonedAt">, day: string): boolean {
  if (task.abandonedAt && task.endDate && task.endDate <= day) return false;
  if (task.endDate && task.endDate <= day && (task.done || task.abandonedAt)) return false;
  if (task.endDate && task.endDate < day) return false;
  if (task.endDate === day && (task.done || task.abandonedAt)) return false;
  return !task.endDate || task.endDate > day;
}

/** How many days an open task has slipped by `day`. Finished tasks are 0. */
export function slipDays(task: Pick<Task, "startDate" | "endDate" | "done" | "abandonedAt">, day: string): number {
  if (!task.startDate || task.startDate >= day) return 0;
  if (!isOpenOn(task, day)) return 0;
  return daysBetween(task.startDate, day);
}

/** View of a task as it stood on `day`. Later completion is hidden. */
export function projectTask(task: Task, day: string): Task {
  if (task.endDate && task.endDate <= day) return { ...task };
  const view: Task = { ...task, done: false };
  delete view.endDate;
  delete view.completedAt;
  delete view.abandonedAt;
  delete view.abandonReason;
  return view;
}

export function compareTasks(a: Task, b: Task, day: string): number {
  const aOpen = isOpenOn(a, day);
  const bOpen = isOpenOn(b, day);
  if (aOpen !== bOpen) return aOpen ? -1 : 1;
  const rank = (a.rank ?? "").localeCompare(b.rank ?? "");
  if (rank !== 0) return rank;
  return a.id.localeCompare(b.id);
}

export function taskMatchesId(task: Pick<Task, "id" | "legacyIds">, id: string): boolean {
  return task.id === id || (task.legacyIds?.includes(id) ?? false);
}
