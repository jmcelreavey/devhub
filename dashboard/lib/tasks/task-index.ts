import fs from "node:fs";
import path from "node:path";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { safeReadJSON } from "@/lib/atomic-write";
import type { Task } from "./types";

export interface TaskNode {
  task: Task;
  date: string;
}

export interface TaskIndex {
  /** Latest daily snapshot of each ID, independent of directory iteration order. */
  byId: Map<string, TaskNode>;
  aliases: Map<string, Set<string>>;
}

/** Shared by link resolution and prerequisite checks; legacy UUIDs remain valid aliases. */
export function loadTaskIndex(): TaskIndex {
  const dir = getActiveTasksDir();
  const byId = new Map<string, TaskNode>();
  const aliases = new Map<string, Set<string>>();
  if (!fs.existsSync(dir)) return { byId, aliases };

  const connect = (from: string, to: string) => {
    const neighbors = aliases.get(from) ?? new Set<string>();
    neighbors.add(to);
    aliases.set(from, neighbors);
  };
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
    const date = file.slice(0, -5);
    const tasks = safeReadJSON<Task[]>(path.join(dir, file), []);
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      if (!task || typeof task.id !== "string") continue;
      const previous = byId.get(task.id);
      if (!previous || date > previous.date) byId.set(task.id, { task, date });
      if (task.rolledFromId && task.rolledFromId !== task.id) {
        connect(task.id, task.rolledFromId);
        connect(task.rolledFromId, task.id);
      }
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

/** A completed newest snapshot must win over an older, still-open snapshot. */
export function currentTaskNode(index: TaskIndex, id: string): TaskNode | null {
  let newest: TaskNode | null = null;
  for (const alias of taskLineageIds(index, id)) {
    const node = index.byId.get(alias);
    if (node && (!newest || node.date > newest.date)) newest = node;
  }
  return newest;
}
