/**
 * Task-note path + markdown scaffold — shared by the task-row action
 * and the DevHub MCP `notes_create_task` tool.
 *
 * Part of the cross-entity note graph: note body carries EntityRefs back
 * to the task; the card uses the stable path to open-or-create.
 */

import {
  entityRefToTaskNoteLink,
  escapeRegExp,
  extractTags,
  joinMarkdownLines,
  mergeEntityRefs,
  parseJiraIssueKey,
  slugify,
  type EntityRef,
} from "../entity-note/index.ts";
import { mergeTaskNoteLinks, taskNoteMetaFence, type TaskNoteLink, type TaskNoteMeta } from "./meta.ts";

export interface TaskNoteSource {
  id: string;
  text: string;
  /** Task day file date (YYYY-MM-DD). */
  date: string;
  jiraKey?: string;
  /** Canonical companion note, retained when the task moves between days. */
  notePath?: string;
  /** Absolute Jira browse URL when known. */
  jiraUrl?: string;
  /** Extra hop-around refs (PR, calendar, …) from Task.links. */
  related?: EntityRef[];
}

/** Repo-relative note path (no extension) for a note derived from a task. */
export function taskNotePath(task: TaskNoteSource): string {
  if (task.notePath) {
    if (!/^task-notes\/[a-zA-Z0-9_-]+$/.test(task.notePath)) throw new Error("Invalid task note path");
    return task.notePath;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(task.date) ? task.date : "undated";
  const id = task.id.trim() || slugify(task.text, { maxLen: 12, fallback: "task" });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid task note id");
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

/** Header metadata a fresh task note starts with: the pills the note view shows. */
export function buildTaskNoteMeta(task: TaskNoteSource): TaskNoteMeta {
  const jira: TaskNoteLink[] = task.jiraKey
    ? [{ kind: "jira", id: task.jiraKey, label: task.jiraKey, ...(task.jiraUrl ? { href: task.jiraUrl } : {}) }]
    : [];
  const related = (task.related ?? [])
    .map(entityRefToTaskNoteLink)
    .filter((link): link is TaskNoteLink => link !== null);
  const tags = extractTags(task.text);
  return {
    status: "todo",
    date: (task.date || "").slice(0, 10),
    ...(tags.length ? { tags } : {}),
    links: mergeTaskNoteLinks(jira, [{ kind: "task", id: task.id, label: "Open in Work", href: "/work?tab=tasks" }], related),
  };
}

/**
 * Markdown scaffold for a task note.
 *
 * The header is one ```task-meta block (status, tags, links) that the note view
 * renders as pills; the `::task-ref` line is the task backlink the entity graph
 * reads. Standard sections (Summary, Decisions, …) are added on demand by
 * `applyTaskNoteOp`, so a new note has no empty headings.
 */
export function buildTaskNoteMarkdown(task: TaskNoteSource): string {
  const title = task.text.trim() || "Untitled task";
  const ref = taskEntityRefs(task)[0];

  return joinMarkdownLines([
    `# ${title}`,
    "",
    taskNoteMetaFence(buildTaskNoteMeta(task)),
    "",
    ref?.marker ?? null,
    "",
    "## Notes",
    "",
    "- ",
  ]);
}

/**
 * Point a task at a newly created Jira ticket: replace its current key with the
 * new one, or prepend the new key when the task had none.
 */
export function rewriteTaskKey(text: string, oldKey: string | undefined, newKey: string): string {
  if (oldKey) {
    // One regex, one pass. Building it twice was a workaround for `/g` leaving
    // `lastIndex` moved after `.test()`; comparing the result sidesteps that.
    const replaced = text.replace(new RegExp(`\\b${escapeRegExp(oldKey)}\\b`, "g"), newKey);
    if (replaced !== text) return replaced;
  }
  return `${newKey} ${text}`.replace(/\s+/g, " ").trim();
}

/** The issue key a hop-link points at, normalised. */
function refJiraKey(ref: EntityRef): string {
  return parseJiraIssueKey(ref.id) || ref.id.toUpperCase();
}

/**
 * The Jira key a task should carry, given its links.
 *
 * Returns null when the task is already associated or has no Jira hop — the
 * single place that decision is made, so text and `jiraKey` cannot disagree.
 */
function promotableJiraKey(
  jiraKey: string | undefined | null,
  links: EntityRef[] | undefined,
  parentKey?: string,
): string | null {
  if (jiraKey) return null;
  const jira = links?.find((link) => link.kind === "jira" && link.id && refJiraKey(link) !== parentKey?.toUpperCase());
  if (!jira) return null;
  return refJiraKey(jira);
}

/**
 * When a task gains a Jira hop-link and isn't already Jira-associated, prepend
 * the issue key to the title so extractors / the Jira chip pick it up.
 */
export function textWithJiraLinkPromotion(
  text: string,
  jiraKey: string | undefined | null,
  links: EntityRef[] | undefined,
  parentKey?: string,
): string {
  const key = promotableJiraKey(jiraKey, links, parentKey);
  if (!key) return text;
  if (new RegExp(`\\b${escapeRegExp(key)}\\b`, "i").test(text)) return text;
  return rewriteTaskKey(text, undefined, key);
}

/**
 * Single write-path helper for UI + MCP: dedupe links and promote a Jira hop
 * into `jiraKey` / title when the task isn't already associated.
 */
export function normalizeTaskLinkState(
  text: string,
  jiraKey: string | undefined | null,
  links: EntityRef[] | undefined,
  parentKey?: string,
): { text: string; jiraKey: string | undefined; links: EntityRef[] | undefined } {
  const deduped = links?.length ? mergeEntityRefs(links) : undefined;
  const nextLinks = deduped && deduped.length > 0 ? deduped : undefined;
  // Derive the key once and reuse it for the title, rather than promoting the
  // text and then re-parsing the key back out of it three different ways.
  const promoted = promotableJiraKey(jiraKey, nextLinks, parentKey);
  return {
    text: promoted ? textWithJiraLinkPromotion(text, jiraKey, nextLinks, parentKey) : text,
    jiraKey: jiraKey || promoted || undefined,
    links: nextLinks,
  };
}
