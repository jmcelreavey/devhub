/**
 * Task-note path + markdown scaffold — shared by the task-row action
 * and the DevHub MCP `notes_create_task` tool.
 *
 * Part of the cross-entity note graph: note body carries EntityRefs back
 * to the task; the card uses the stable path to open-or-create.
 */

import {
  buildEntityLinksSection,
  escapeRegExp,
  joinMarkdownLines,
  mergeEntityRefs,
  parseJiraIssueKey,
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
): string | null {
  if (jiraKey) return null;
  const jira = links?.find((l) => l.kind === "jira" && l.id);
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
): string {
  const key = promotableJiraKey(jiraKey, links);
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
): { text: string; jiraKey: string | undefined; links: EntityRef[] | undefined } {
  const deduped = links?.length ? mergeEntityRefs(links) : undefined;
  const nextLinks = deduped && deduped.length > 0 ? deduped : undefined;
  // Derive the key once and reuse it for the title, rather than promoting the
  // text and then re-parsing the key back out of it three different ways.
  const promoted = promotableJiraKey(jiraKey, nextLinks);
  return {
    text: promoted ? textWithJiraLinkPromotion(text, jiraKey, nextLinks) : text,
    jiraKey: jiraKey || promoted || undefined,
    links: nextLinks,
  };
}

