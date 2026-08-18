/**
 * Pure text handling for tasks: Jira key rewriting, markdown-link parsing,
 * bare-URL detection, search matching.
 *
 * Extracted from `components/TaskList.tsx` (R11). All of it was pure string
 * work living inside a 1,400-line client component, which meant none of it
 * could be tested without mounting React — so none of it was tested, despite
 * being the part most likely to be subtly wrong (regex, escaping, indices).
 *
 * No React import here on purpose; the rendering half lives in
 * `components/tasks/TaskText.tsx`.
 */
import { todayISO } from "@/lib/utils";
import type { EntityRef } from "@/lib/entity-note";
import type { Task } from "@/lib/tasks/types";

export const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** A bare URL, excluding one already inside a markdown link's parentheses. */
export const BARE_URL_RE = /(?<!\(\s?)https?:\/\/[^\s)\]]+/;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove a Jira key from the task text once it's shown as a chip instead. */
export function stripLinkedJiraKeyFromText(text: string, jiraKey: string): string {
  const re = new RegExp(`\\b${escapeRegExp(jiraKey)}\\b`, "gi");
  return text
    .replace(re, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—,:]\s*/, "")
    .trim();
}

/**
 * Point a task at a newly created Jira ticket: replace its current key with the
 * new one (so the chip/status/link all track the new ticket), or prepend the
 * new key when the task had none.
 */
export function rewriteTaskKey(text: string, oldKey: string | undefined, newKey: string): string {
  if (oldKey) {
    const re = new RegExp(`\\b${escapeRegExp(oldKey)}\\b`, "g");
    if (re.test(text)) return text.replace(new RegExp(`\\b${escapeRegExp(oldKey)}\\b`, "g"), newKey);
  }
  return `${newKey} ${text}`.replace(/\s+/g, " ").trim();
}

/**
 * When a task gains a Jira hop-link and isn't already Jira-associated, prepend
 * the issue key to the title so `extractJiraKey` / the Jira chip pick it up.
 *
 * Does not demote on link removal — edit the title (or clear the key) to change
 * association. Skips when the key is already in the text.
 */
export function textWithJiraLinkPromotion(
  text: string,
  jiraKey: string | undefined,
  links: EntityRef[] | undefined,
): string {
  if (jiraKey) return text;
  const jira = links?.find((l) => l.kind === "jira" && l.id);
  if (!jira) return text;
  const key = jira.id.toUpperCase();
  if (new RegExp(`\\b${escapeRegExp(key)}\\b`, "i").test(text)) return text;
  return rewriteTaskKey(text, undefined, key);
}

export interface TextPart {
  type: "text" | "link";
  text: string;
  url?: string;
}

export function parseMarkdownLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MD_LINK_RE)) {
    if (match.index! > lastIndex) {
      parts.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "link", text: match[1], url: match[2] });
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.slice(lastIndex) });
  }
  return parts;
}

/**
 * A URL typed on its own, so the UI can offer to turn it into a named link.
 *
 * `MD_LINK_RE` is a module-level /g regex, so `lastIndex` is shared state: miss
 * a reset around `.test()` and consecutive calls alternate between matching and
 * not. The original handled this correctly; the resets are hoisted here purely
 * to make the requirement obvious, and there is now a test pinning it so a
 * future "simplification" can't quietly reintroduce the hazard.
 */
export function detectBareUrl(text: string): string | null {
  MD_LINK_RE.lastIndex = 0;
  const hasMarkdownLink = MD_LINK_RE.test(text);
  MD_LINK_RE.lastIndex = 0;
  if (hasMarkdownLink) return null;
  const match = text.match(BARE_URL_RE);
  return match ? match[0] : null;
}

/** One quiet line for a cleared queue - date-seeded so it holds all day. */
export const CLEARED_LINES = [
  "Done for today. Touch grass.",
  "Queue clear. Go build something.",
  "Nothing owed. Savour it.",
  "All clear - the rest of the day is yours.",
] as const;

export function clearedLineForToday(today = todayISO()): string {
  const seed = today.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return CLEARED_LINES[seed % CLEARED_LINES.length];
}

/**
 * Free-text task match: whitespace-separated terms are AND-ed, so
 * "ptf login" narrows rather than falling over.
 *
 * Searches the task body, its Jira key, its due date, the abandon reason, and
 * the labels/ids of anything linked to it (PRs, notes, calendar events).
 */
export function matchesTaskSearch(task: Task, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [
    task.text,
    task.jiraKey ?? "",
    task.due ?? "",
    task.abandonReason ?? "",
    ...(task.links ?? []).flatMap((link) => [link.kind, link.id, link.label]),
  ]
    .join("   ")
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}
