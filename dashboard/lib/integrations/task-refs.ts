import type { Task } from "@shared/tasks/types.ts";
import { RefSchema, refKey, type IntegrationRef } from "./types";

export function taskRefs(task: Task): IntegrationRef[] {
  const refs = (task.integrationRefs ?? []).filter((ref) => RefSchema.safeParse(ref).success);
  if (task.jiraKey && !refs.some((ref) => ref.provider === "jira" && ref.account === "default" && ref.id === task.jiraKey)) refs.push({ provider: "jira", account: "default", kind: "issue", id: task.jiraKey });
  for (const link of task.links ?? []) {
    const match = link.href?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9][0-9]*)(?:[/?#]|$)/);
    if (match) refs.push({ provider: "github", account: "default", kind: "pr", id: match[1] + "/" + match[2] });
  }
  return [...new Map(refs.map((ref) => [refKey(ref), ref])).values()];
}
