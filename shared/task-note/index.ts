/**
 * Task-note path + markdown scaffold — shared by the task-row action
 * and the DevHub MCP `notes_create_task` tool.
 *
 * Part of the cross-entity note graph: note body carries EntityRefs back
 * to the task; the card uses the stable path to open-or-create.
 */

import {
  buildEntityLinksSection,
  joinMarkdownLines,
  slugify,
  type EntityRef,
} from "../entity-note/index.ts";

export interface TaskNoteSource {
  id: string;
  text: string;
  /** Task day file date (YYYY-MM-DD). */
  date: string;
  jiraKey?: string;
  /** Absolute Jira browse URL when known. */
  jiraUrl?: string;
  /** Extra hop-around refs (PR, calendar, …) from Task.links. */
  related?: EntityRef[];
}

/** Repo-relative note path (no extension) for a note derived from a task. */
export function taskNotePath(task: TaskNoteSource): string {
  const date = (task.date || "").slice(0, 10) || "undated";
  const id = task.id.trim() || slugify(task.text, { maxLen: 12, fallback: "task" });
  return `task-notes/${date}-${id}`;
}

/** EntityRefs embedded in a task note's ## Links section. */
export function taskEntityRefs(task: TaskNoteSource): EntityRef[] {
  const title = (task.text.trim() || "Untitled task").replace(/\s+/g, " ");
  return [
    {
      kind: "task",
      id: task.id,
      label: title,
      marker: `::task-ref ${task.id} ${task.date} ${title}`,
    },
    {
      kind: "task",
      id: task.id,
      label: "Open in Work",
      href: "/work?tab=tasks",
    },
    ...(task.related ?? []),
  ];
}

/** Markdown scaffold for a task note, with EntityRef backlinks. */
export function buildTaskNoteMarkdown(task: TaskNoteSource): string {
  const title = task.text.trim() || "Untitled task";
  const links = buildEntityLinksSection(taskEntityRefs(task));

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
