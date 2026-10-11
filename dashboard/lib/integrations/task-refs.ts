import { createHash } from "node:crypto";
import { getActiveTasksDir } from "@/lib/notes/dir";
import { ensureTasksMigrated } from "@/lib/tasks/storage";
import { findTask, patchTask, withTaskLock } from "@shared/tasks/store.ts";
import type { Task } from "@shared/tasks/types.ts";
import { IntegrationError, RefSchema, refKey, type IntegrationRef } from "./types";

export function taskRefs(task: Task): IntegrationRef[] {
  const refs = (task.integrationRefs ?? []).filter((ref) => RefSchema.safeParse(ref).success);
  if (task.jiraKey && !refs.some((ref) => ref.provider === "jira" && ref.account === "default" && ref.id === task.jiraKey)) refs.push({ provider: "jira", account: "default", kind: "issue", id: task.jiraKey });
  for (const link of task.links ?? []) {
    const match = link.href?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9][0-9]*)(?:[/?#]|$)/);
    if (match) refs.push({ provider: "github", account: "default", kind: "pr", id: match[1] + "/" + match[2] });
  }
  return [...new Map(refs.map((ref) => [refKey(ref), ref])).values()];
}
export function refsRevision(refs: IntegrationRef[]) { return createHash("sha256").update(JSON.stringify(refs)).digest("hex"); }
export async function linkTaskRef(taskId: string, ref: IntegrationRef, revision: string, remove: boolean) {
  await ensureTasksMigrated();
  const root = getActiveTasksDir();
  return withTaskLock(root, () => {
    const task = findTask(root, taskId);
    if (!task) throw new IntegrationError("not-found", "Task not found.");
    const saved = task.integrationRefs ?? [];
    if (refsRevision(taskRefs(task)) !== revision) throw new IntegrationError("conflict", "Task links changed. Refresh before trying again.");
    const refs = saved.filter((item) => refKey(item) !== refKey(ref));
    if (!remove) refs.push(RefSchema.parse(ref));
    if (refs.length > 50) throw new IntegrationError("invalid", "At most 50 integration links per task.");
    return patchTask(root, taskId, { integrationRefs: refs });
  });
}
