import path from "node:path";
import { parseJiraIssueKey } from "@shared/entity-note/index.ts";
import { isTaskNotePath, readTaskNoteWithMigration } from "@shared/task-note/sections.ts";
import type { TaskNoteLink } from "@shared/task-note/meta.ts";
import { resolveActiveProfileId } from "@shared/vault/task-profiles.ts";
import { getActiveTasksDir, getNotesDir, getTasksDir } from "@/lib/notes/dir";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { NotesStorage } from "@/lib/storage";
import { captureDraftTask } from "./capture";
import { loadTaskIndex, type TaskNode } from "./task-index";
import { createTaskNoteResolver } from "./task-notes";
import { isTaskOpen, type Task } from "./types";

export interface JiraLinkedTask {
  taskId: string;
  date: string;
}

export const jiraIntakeProfile = () => resolveActiveProfileId(getTasksDir()) ?? "legacy";

function taskJiraKeys(task: Task, noteLinks: TaskNoteLink[]): string[] {
  return [...new Set([task.jiraKey ?? "", ...[...(task.links ?? []), ...noteLinks].filter((link) => link.kind === "jira").map((link) => link.id), ...(task.integrationRefs ?? []).filter((ref) => ref.provider === "jira").map((ref) => ref.id)].flatMap((raw) => {
    const key = parseJiraIssueKey(raw);
    return key && key !== task.parentKey ? [key] : [];
  }))];
}

function linkedTasks(): Map<string, TaskNode> {
  const nodes = [...new Map([...loadTaskIndex().byId.values()].map((node) => [node.task.id, node])).values()]
    .sort((left, right) => Number(isTaskOpen(right.task)) - Number(isTaskOpen(left.task)) || right.task.createdAt.localeCompare(left.task.createdAt));
  const linked = new Map<string, TaskNode>();
  const resolveNote = createTaskNoteResolver();
  const storage = new NotesStorage(getNotesDir());
  for (const node of nodes) {
    const notePath = resolveNote(node.task, node.date).notePath;
    if (!isTaskNotePath(notePath) || notePath.includes("..")) throw new Error("Couldn't check Jira links: a task has an invalid note path.");
    const note = storage.read(notePath);
    let links: TaskNoteLink[] = [];
    if (note) {
      const content = note.content;
      if (!Array.isArray(content)) throw new Error("Couldn't check Jira links: a task note couldn't be read.");
      links = readTaskNoteWithMigration(content).meta?.links ?? [];
    }
    for (const key of taskJiraKeys(node.task, links)) if (!linked.has(key)) linked.set(key, node);
  }
  return linked;
}

export function jiraLinkedTasks(): Record<string, JiraLinkedTask> {
  return Object.fromEntries([...linkedTasks()].map(([key, node]) => [key, { taskId: node.task.id, date: node.date }]));
}

export async function captureJiraTask(input: { key: string; summary: string; url: string; profile?: string }) {
  return withPluginMutationLock(path.join(getActiveTasksDir(), ".jira-intake", input.key), async () => {
    if (input.profile && input.profile !== jiraIntakeProfile()) return { profileChanged: true as const };
    const existing = linkedTasks().get(input.key);
    if (existing) return { task: existing.task, date: existing.date, created: false };
    const result = await captureDraftTask({ text: `${input.key} ${input.summary}`.slice(0, 500), links: [{ kind: "jira", id: input.key, label: input.key, href: input.url }] });
    return { task: result.task, date: result.date, created: true };
  });
}
