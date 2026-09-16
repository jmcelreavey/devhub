/**
 * Server-side inputs for the implement-ready checklist.
 * Reuses the same task/note/repo neighbourhood as GET /api/tasks/implement/plan.
 */
import fs from "node:fs";
import path from "node:path";
import { getNotesDir, getTasksDir } from "@/lib/content/dirs";
import { blocksToText } from "@/lib/markdown-convert";
import { getResolvedJiraEnv, authHeader, apiBase } from "@/lib/jira/env";
import { taskNotePath } from "@/lib/task-note";
import { isTaskOpen, type Task } from "@/lib/tasks/types";
import {
  taskTextHasPrerequisiteTag,
  type OpenPrerequisiteBlocker,
} from "@/lib/tasks/implement-ready";

interface TaskNode {
  task: Task;
  date: string;
}

function loadTaskIndex(): { byId: Map<string, TaskNode>; all: TaskNode[] } {
  const byId = new Map<string, TaskNode>();
  const all: TaskNode[] = [];
  const dir = getTasksDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return { byId, all };
  }
  for (const file of files) {
    let tasks: Task[];
    try {
      tasks = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Task[];
    } catch {
      continue;
    }
    if (!Array.isArray(tasks)) continue;
    const date = file.replace(/\.json$/, "");
    for (const task of tasks) {
      if (!task || typeof task.id !== "string") continue;
      const node = { task, date };
      byId.set(task.id, node);
      all.push(node);
    }
  }
  return { byId, all };
}

function noteFilePath(relPath: string): string | null {
  const root = path.resolve(getNotesDir());
  const full = path.resolve(root, `${relPath}.json`);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

/** Task note body as round-trip markdown, or null when missing. */
export function readTaskNoteMarkdown(notePath: string): string | null {
  const full = noteFilePath(notePath);
  if (!full || !fs.existsSync(full)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(full, "utf8")) as unknown;
    const blocks = Array.isArray(raw) ? raw : (raw as { content?: unknown })?.content;
    if (!Array.isArray(blocks)) return null;
    return blocksToText(blocks);
  } catch {
    return null;
  }
}

/** Flatten ADF (or plain string) description to plain text for the checklist. */
export function adfToPlainText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const obj = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof obj.text === "string") return obj.text;
  if (!Array.isArray(obj.content)) return "";
  const parts = obj.content.map(adfToPlainText);
  // Block nodes separate with newlines; inline runs concatenate.
  const block = obj.type === "doc" || obj.type === "bulletList" || obj.type === "orderedList" || obj.type === "blockquote";
  return parts.join(block ? "\n" : "");
}

/** Best-effort Jira description text; null when unconfigured / missing / error. */
export async function fetchJiraDescriptionText(key: string): Promise<string | null> {
  const j = getResolvedJiraEnv();
  if (!j) return null;
  try {
    const res = await fetch(`${apiBase(j)}/issue/${encodeURIComponent(key)}?fields=description`, {
      headers: {
        Authorization: authHeader(j),
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { fields?: { description?: unknown } };
    const text = adfToPlainText(data.fields?.description ?? null).trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Open tasks tagged #prerequisite / #prereq / #blocker that either this task
 * links to, or that link back to this task.
 */
export function collectOpenPrerequisiteBlockers(
  taskId: string,
  links: Task["links"] | undefined,
): OpenPrerequisiteBlocker[] {
  const { byId, all } = loadTaskIndex();
  const out = new Map<string, OpenPrerequisiteBlocker>();

  const consider = (node: TaskNode | undefined) => {
    if (!node) return;
    if (node.task.id === taskId) return;
    if (node.task.movedAt) return;
    if (!isTaskOpen(node.task)) return;
    if (!taskTextHasPrerequisiteTag(node.task.text)) return;
    out.set(node.task.id, {
      id: node.task.id,
      text: node.task.text,
      date: node.date,
    });
  };

  for (const link of links ?? []) {
    if (link.kind !== "task") continue;
    consider(byId.get(link.id));
  }

  for (const node of all) {
    if (node.task.movedAt) continue;
    const pointsHere = node.task.links?.some((l) => l.kind === "task" && l.id === taskId);
    if (!pointsHere) continue;
    consider(node);
  }

  return [...out.values()];
}

export function resolveTaskNotePath(task: Task, date: string): string {
  return taskNotePath({
    id: task.id,
    text: task.text,
    date,
    jiraKey: task.jiraKey,
  });
}
