import type { JiraTicketRef } from "@/lib/jira/client";

export interface ParentGroup<T> {
  /** Null for tasks with no known Jira parent. */
  parent: JiraTicketRef | null;
  tasks: T[];
}

/**
 * Clusters tasks under their Jira parent. Groups appear in order of first
 * appearance and tasks keep their existing order, so a manual ranking survives
 * inside each group. Tasks without a known parent trail as one group.
 */
export function groupTasksByParent<T>(
  tasks: readonly T[],
  parentOf: (task: T) => JiraTicketRef | null | undefined,
): ParentGroup<T>[] {
  const byKey = new Map<string, ParentGroup<T>>();
  const unparented: T[] = [];

  for (const task of tasks) {
    const parent = parentOf(task);
    if (!parent) {
      unparented.push(task);
      continue;
    }
    const group = byKey.get(parent.key);
    if (group) group.tasks.push(task);
    else byKey.set(parent.key, { parent, tasks: [task] });
  }

  const groups = [...byKey.values()];
  return unparented.length > 0 ? [...groups, { parent: null, tasks: unparented }] : groups;
}
