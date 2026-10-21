import { getActiveTasksDir, getTasksDir } from "@/lib/notes/dir";
import { ensureTasksMigrated } from "@/lib/tasks/storage";
import { withTaskProfileRequest } from "@/lib/tasks/profile-request";
import { findTask, patchTask, withTaskLock } from "@shared/tasks/store.ts";
import type { Task } from "@shared/tasks/types.ts";
import { isValidProfileId, listTaskProfiles } from "@shared/vault/task-profiles.ts";
import { IntegrationError } from "./types";
import type { WriteResult } from "./write-types";

async function withWriteTask<T>(profile: string, taskId: string, work: (task: Task, root: string) => T): Promise<T> {
  if (!isValidProfileId(profile)) throw new IntegrationError("invalid", "Invalid task profile.");
  const target = profile === "default" && listTaskProfiles(getTasksDir()).length === 0 ? "legacy" : profile;
  return withTaskProfileRequest(target, async () => {
    await ensureTasksMigrated();
    const root = getActiveTasksDir();
    return withTaskLock(root, () => {
      const task = findTask(root, taskId);
      if (!task) throw new IntegrationError("not-found", "Task not found in the result's profile.");
      return work(task, root);
    });
  });
}

export function captureTaskJiraKey(profile: string, taskId: string): Promise<string | null> {
  return withWriteTask(profile, taskId, (task) => task.jiraKey ?? null);
}

export async function linkCreatedJiraTask(result: WriteResult): Promise<"linked" | "skipped"> {
  const { input, receipt } = result;
  if (result.state !== "succeeded" || input.action !== "issue.create" || !input.taskId || result.taskJiraKey === undefined) return "skipped";
  const item = receipt?.item;
  const key = item?.ref.id;
  if (!key || item.ref.provider !== "jira" || item.ref.kind !== "issue" || item.ref.account !== input.account || !/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(key) || key === input.parentKey) return "skipped";
  return withWriteTask(result.profile, input.taskId, (task, root) => {
    if (task.jiraKey === key) return "linked";
    if ((task.jiraKey ?? null) !== result.taskJiraKey) return "skipped";
    const parentKey = input.parentKey ?? task.parentKey;
    const prefix = task.text.match(/^([A-Z][A-Z0-9_]*-\d+)\b\s*[:—–-]?\s*/);
    const summary = prefix && (prefix[1] === task.jiraKey || prefix[1] === parentKey) ? task.text.slice(prefix[0].length) : task.text;
    const links = (task.links ?? []).filter((link) => link.kind !== "jira" || ![task.jiraKey, key, parentKey].includes(link.id));
    links.push({ kind: "jira", id: key, label: key, href: item.url });
    if (parentKey) {
      const parent = task.links?.find((link) => link.kind === "jira" && link.id === parentKey);
      links.push({ ...parent, kind: "jira", id: parentKey, label: `Parent ${parentKey}` });
    }
    const integrationRefs = (task.integrationRefs ?? []).filter((ref) => ref.provider !== "jira" || ref.account !== input.account || ![task.jiraKey, key, parentKey].includes(ref.id));
    integrationRefs.push(item.ref);
    patchTask(root, task.id, { jiraKey: key, text: `${key}: ${summary}`, parentKey, links, integrationRefs });
    return "linked";
  });
}
