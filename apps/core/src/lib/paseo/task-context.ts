import { readItems } from "../../domains/tasks/store";
import { getActiveTasksDir } from "../notes/dir";
import { findAgentRunByConversation } from "../agent-runs/store";
import { buildPlanMarkdown } from "../../domains/tasks/plan-markdown";
import { readSourceContextIfPresent } from "../../domains/tasks/source-context";

export function taskContextSnapshots(input: { query?: string; agentId?: string; taskId?: string; origin: string }) {
  let taskId = input.taskId;
  if (input.agentId) {
    taskId = findAgentRunByConversation(input.agentId)?.spec.activity?.taskId;
    if (!taskId) return { items: [], linked: false };
  }
  const query = input.query?.trim().toLocaleLowerCase() || "";
  const tasks = readItems(getActiveTasksDir()).filter(task => taskId ? task.id === taskId :
    query ? [task.id, task.text, task.jiraKey].some(value => value?.toLocaleLowerCase().includes(query)) : !task.done && !task.abandonedAt)
    .sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 5);
  return { linked: !!taskId && tasks.length > 0, items: tasks.map(task => {
    const date = task.startDate;
    const context = readSourceContextIfPresent(task.id);
    const text = buildPlanMarkdown(task, date);
    if (Buffer.byteLength(text) > 96_000) throw new Error("This task snapshot is too large to attach. Review and export its plan in DevHub.");
    return { id: task.id, identifier: task.jiraKey || task.id.slice(0, 8), title: task.text,
      subtitle: context?.stale ? "Source context changed; review the handoff" : "Task brief and saved context",
      url: input.origin + "/work?task=" + encodeURIComponent(task.id),
      text, resourceType: "devhub-task",
    };
  }) };
}
