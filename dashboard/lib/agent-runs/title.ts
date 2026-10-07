import { clip } from "./events";
import type { AgentActivityContext } from "./run-files";
import { getTasks } from "@/lib/tasks/storage";
import { parseJiraIssueKey } from "@/lib/entity-note";
import { stripLinkedJiraKeyFromText } from "@/lib/tasks/task-text";

const ACTIONS: Record<string, string> = {
  plan: "Plan", implement: "Implement", resume: "Continue", "create-pr": "Create PR",
};

/** Use task metadata, never the skill invocation at the start of the prompt. */
export function agentRunTitle(input: { title?: string; prompt: string; activity?: AgentActivityContext }): string {
  const activity = input.activity;
  const task = activity?.taskId && activity.taskDate
    ? getTasks(activity.taskDate).find((item) => item.id === activity.taskId)
    : undefined;
  const action = activity && ACTIONS[activity.action];
  if (!task || !action) return input.title?.trim().slice(0, 80) || clip(input.prompt.trim().split("\n")[0] ?? "", 60);
  const key = task.jiraKey || parseJiraIssueKey(task.text);
  const text = (key ? stripLinkedJiraKeyFromText(task.text, key) : task.text)
    .replace(/(^|\s)#[\w-]+/g, " ").replace(/\s+/g, " ").trim();
  return [action, key, text || "Task"].filter(Boolean).join(" · ").slice(0, 80);
}
