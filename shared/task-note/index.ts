/**
 * Task-note path + markdown scaffold — shared by the task-row action
 * and the DevHub MCP `notes_create_task` tool.
 */

import { buildEntityLinksSection, joinMarkdownLines, slugify } from "../entity-note/index.ts";

export interface TaskNoteSource {
  id: string;
  text: string;
  /** Task day file date (YYYY-MM-DD). */
  date: string;
  jiraKey?: string;
  /** Absolute Jira browse URL when known. */
  jiraUrl?: string;
}

/** Repo-relative note path (no extension) for a note derived from a task. */
export function taskNotePath(task: TaskNoteSource): string {
  const date = (task.date || "").slice(0, 10) || "undated";
  const id = task.id.trim() || slugify(task.text, { maxLen: 12, fallback: "task" });
  return `task-notes/${date}-${id}`;
}

/** Markdown scaffold for a task note, with a live taskRef backlink. */
export function buildTaskNoteMarkdown(task: TaskNoteSource): string {
  const title = task.text.trim() || "Untitled task";
  const label = title.replace(/\s+/g, " ");
  const links = buildEntityLinksSection([
    `::task-ref ${task.id} ${task.date} ${label}`,
    "**Work:** [Open in Work](/work?tab=tasks)",
  ]);

  return joinMarkdownLines([
    `# ${title}`,
    "",
    `**Date:** ${(task.date || "").slice(0, 10)}`,
    task.jiraKey && task.jiraUrl
      ? `**Jira:** [${task.jiraKey}](${task.jiraUrl})`
      : task.jiraKey
        ? `**Jira:** ${task.jiraKey}`
        : null,
    "",
    links.trimEnd(),
    "",
    "## Notes",
    "",
    "- ",
    "",
    "## Action items",
    "",
    "- [ ] ",
  ]);
}
