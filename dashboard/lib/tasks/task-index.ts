import { getActiveTasksDir } from "@/lib/content/dirs";
import { readItems } from "@shared/tasks/store.ts";
import type { Task } from "./types";

export interface TaskNode {
  task: Task;
  date: string;
}

export interface TaskIndex {
  /** Surviving item for each canonical id and each legacy id. */
  byId: Map<string, TaskNode>;
  aliases: Map<string, Set<string>>;
}

function connect(aliases: Map<string, Set<string>>, from: string, to: string): void {
  const neighbors = aliases.get(from) ?? new Set<string>();
  neighbors.add(to);
  aliases.set(from, neighbors);
}

/** One node per item. Legacy day-file ids resolve to the surviving item. */
export function loadTaskIndex(): TaskIndex {
  const byId = new Map<string, TaskNode>();
  const aliases = new Map<string, Set<string>>();
  let tasks: Task[] = [];
  try {
    tasks = readItems(getActiveTasksDir());
  } catch {
    tasks = [];
  }
  for (const task of tasks) {
    const date = task.endDate ?? task.legacyThrough ?? task.startDate;
    const node = { task, date };
    byId.set(task.id, node);
    for (const legacyId of task.legacyIds ?? []) {
      if (legacyId === task.id) continue;
      byId.set(legacyId, node);
      connect(aliases, task.id, legacyId);
      connect(aliases, legacyId, task.id);
    }
  }
  return { byId, aliases };
}

export function taskLineageIds(index: TaskIndex, id: string): Set<string> {
  const ids = new Set([id]);
  for (const current of ids) {
    for (const alias of index.aliases.get(current) ?? []) ids.add(alias);
  }
  return ids;
}

/** Legacy ids resolve to the surviving item, not a newer day-file copy. */
export function currentTaskNode(index: TaskIndex, id: string): TaskNode | null {
  const direct = index.byId.get(id);
  if (direct) return direct;
  for (const alias of taskLineageIds(index, id)) {
    const node = index.byId.get(alias);
    if (node) return node;
  }
  return null;
}
