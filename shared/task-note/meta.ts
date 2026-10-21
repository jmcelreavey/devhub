/**
 * Task-note header metadata: status, tags, links and models.
 *
 * Stored as one ```task-meta fenced JSON block right under the note title. A
 * fence is plain markdown, so it round-trips through every converter, stays
 * editable in the normal editor and diffs as a few readable lines. The note
 * view renders it as the pill row; nothing here renders as bullet lines.
 */

import { isRank } from "./rank.ts";

export const TASK_META_LANG = "task-meta";

export const TASK_NOTE_STATUSES = [
  "todo",
  "planning",
  "in-progress",
  "needs-you",
  "blocked",
  "draft-pr",
  "ready-for-review",
  "done",
] as const;

export type TaskNoteStatus = (typeof TASK_NOTE_STATUSES)[number];

export const TASK_NOTE_STATUS_LABEL: Record<TaskNoteStatus, string> = {
  todo: "To do",
  planning: "Planning",
  "in-progress": "In progress",
  "needs-you": "Needs you",
  blocked: "Blocked",
  "draft-pr": "PR open",
  "ready-for-review": "Ready for review",
  done: "Done",
};

export function isTaskNoteStatus(value: unknown): value is TaskNoteStatus {
  return typeof value === "string" && (TASK_NOTE_STATUSES as readonly string[]).includes(value);
}

/** One header pill that points somewhere: PR, Jira, repo, preview URL, the task. */
export interface TaskNoteLink {
  /** `pr`, `jira`, `repo`, `preview`, `task`, `note`, `diagram`, … Free-form so plugins can add kinds. */
  kind: string;
  id: string;
  label: string;
  href?: string;
}

export interface TaskNoteMeta {
  /** Known statuses are typed; an unrecognised hand-written value is kept and shown as is. */
  status?: string;
  statusSetAt?: string;
  /** Day the task note was created (YYYY-MM-DD). */
  date?: string;
  tags?: string[];
  models?: string[];
  links?: TaskNoteLink[];
  /** Position in its Storyboard column (fractional, see rank.ts); absent = the board's default order. */
  rank?: string;
}

const KEY_ORDER = ["status", "statusSetAt", "date", "rank", "tags", "models", "links"] as const;
const FENCE_RE = /^```task-meta[ \t]*\n([\s\S]*?)\n?```[ \t]*$/m;

/** http(s) or an in-app path. Anything else (javascript:, data:, //host) is dropped. */
export function safeLinkHref(href: unknown): string | undefined {
  if (typeof href !== "string") return undefined;
  const value = href.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return undefined;
}

export function taskNoteLinkKey(link: Pick<TaskNoteLink, "kind" | "id">): string {
  return `${link.kind}:${link.id}`;
}

function cleanString(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function cleanList(value: unknown, max = 40): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const text = cleanString(item, 80);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out.length ? out : undefined;
}

/** Validate one link; returns null when it has neither a label nor a usable target. */
export function normalizeTaskNoteLink(raw: unknown): TaskNoteLink | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const kind = cleanString(input.kind, 24)?.toLowerCase();
  const href = safeLinkHref(input.href);
  const label = cleanString(input.label, 160) ?? cleanString(input.id, 160) ?? href;
  if (!kind || !label) return null;
  const id = cleanString(input.id, 300) ?? href ?? label;
  return { kind, id, label, ...(href ? { href } : {}) };
}

export function mergeTaskNoteLinks(...groups: Array<readonly TaskNoteLink[] | undefined>): TaskNoteLink[] {
  const out = new Map<string, TaskNoteLink>();
  for (const group of groups) {
    for (const link of group ?? []) {
      const key = taskNoteLinkKey(link);
      // Later wins so a refreshed label or href replaces the stale one in place.
      out.set(key, { ...out.get(key), ...link });
    }
  }
  return [...out.values()];
}

/** Coerce arbitrary parsed JSON into a clean meta object; unknown keys are dropped. */
export function normalizeTaskNoteMeta(raw: unknown): TaskNoteMeta {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const meta: TaskNoteMeta = {};
  const status = cleanString(input.status, 40);
  if (status) meta.status = status;
  const statusSetAt = cleanString(input.statusSetAt, 40);
  if (statusSetAt && Number.isFinite(Date.parse(statusSetAt))) meta.statusSetAt = statusSetAt;
  const date = cleanString(input.date, 10);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) meta.date = date;
  const tags = cleanList(input.tags)?.map((tag) => tag.replace(/^#/, "").toLowerCase());
  if (tags?.length) meta.tags = [...new Set(tags)];
  const models = cleanList(input.models);
  if (models) meta.models = models;
  if (Array.isArray(input.links)) {
    const links = mergeTaskNoteLinks(
      input.links.map(normalizeTaskNoteLink).filter((l): l is TaskNoteLink => l !== null),
    );
    if (links.length) meta.links = links;
  }
  if (isRank(input.rank)) meta.rank = input.rank;
  return meta;
}

/** Stable key order and two-space indent so the fence diffs cleanly. */
export function serializeTaskNoteMeta(meta: TaskNoteMeta): string {
  const clean = normalizeTaskNoteMeta(meta);
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (clean[key] !== undefined) ordered[key] = clean[key];
  }
  return JSON.stringify(ordered, null, 2);
}

/** Parse the body of a task-meta fence. Null means "present but not valid JSON". */
export function parseTaskNoteMetaText(text: string): TaskNoteMeta | null {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeTaskNoteMeta(parsed);
  } catch {
    return null;
  }
}

/** Meta from a note's markdown, or null when the note has no (valid) task-meta fence. */
export function extractTaskNoteMetaFromMarkdown(markdown: string): TaskNoteMeta | null {
  const match = markdown.match(FENCE_RE);
  return match ? parseTaskNoteMetaText(match[1] ?? "") : null;
}

export function hasTaskNoteMeta(markdown: string): boolean {
  return FENCE_RE.test(markdown);
}

export function taskNoteMetaFence(meta: TaskNoteMeta): string {
  return ["```" + TASK_META_LANG, serializeTaskNoteMeta(meta), "```"].join("\n");
}

/** Replace the note's task-meta fence in markdown text; unchanged when the note has none. */
export function replaceTaskNoteMetaInMarkdown(markdown: string, meta: TaskNoteMeta): string {
  if (!FENCE_RE.test(markdown)) return markdown;
  return markdown.replace(FENCE_RE, () => taskNoteMetaFence(meta));
}
