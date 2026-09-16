/**
 * Capture an idea as a draft task, with a snapshot of what's around it.
 *
 * Getting the thought down is the point, so capture never fails on context:
 * related notes, PRs, earlier tasks and recent alerts are best-effort and go
 * into the task note under "## Context snapshot" for whoever writes the plan.
 */
import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { writeAtomic } from "@/lib/atomic-write";
import { textToBlocks } from "@/lib/markdown-convert";
import { searchNotes } from "@/lib/notes/search";
import { readGithubPrsListCache } from "@/lib/github/prs";
import { loadRecentAlerts } from "@/lib/datadog/recent-server";
import { datadogAppOrigin } from "@/lib/datadog/links";
import { buildTaskNoteMarkdown, taskNotePath } from "@/lib/task-note";
import { JIRA_KEY_RE, todayISO } from "@/lib/utils";
import { addTask, listTaskDays } from "@/lib/tasks/storage";
import type { EntityRef, Task } from "@/lib/tasks/types";

const MAX_PER_KIND = 5;
/** Filler and generic task verbs — they match half the vault and say nothing about the topic. */
const STOPWORDS = new Set([
  "about", "after", "again", "could", "every", "should", "there", "these", "thing", "things",
  "which", "while", "would", "where", "their", "other", "check", "maybe", "might", "something",
  "investigate", "implement", "review", "update", "create", "figure", "fixed", "looking", "working",
  "support", "change", "changes", "issue", "issues", "problem", "please", "follow",
]);

export interface CaptureContext {
  notes: Array<{ path: string; excerpt: string }>;
  prs: Array<{ url: string; title: string; repo: string }>;
  tasks: Array<{ text: string; date: string; state: "done" | "abandoned" | "open" }>;
  alerts: Array<{ title: string; url: string; at: string }>;
}

/** Up to three search terms: a Jira key, then the longest meaningful words. */
export function captureKeywords(text: string): string[] {
  const key = text.match(JIRA_KEY_RE)?.[1];
  const words = [
    ...new Set(
      text
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .split(/[^a-z0-9-]+/)
        .filter((w) => w.length >= 5 && !STOPWORDS.has(w)),
    ),
  ].sort((a, b) => b.length - a.length);
  return [...new Set([...(key ? [key.toLowerCase()] : []), ...words])].slice(0, 3);
}

function matchesAny(haystack: string, keywords: string[]): boolean {
  const lower = haystack.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

async function recentAlerts(keywords: string[]): Promise<CaptureContext["alerts"]> {
  const load = await Promise.race([
    loadRecentAlerts(20),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
  ]).catch(() => null);
  if (!load?.ok) return [];
  const origin = datadogAppOrigin(load.ddSite);
  return [...load.oncall, ...load.teamSlack]
    .filter((e) => matchesAny(e.title, keywords))
    .slice(0, MAX_PER_KIND)
    .map((e) => ({
      title: e.title,
      url: `${origin}/event/event?id=${encodeURIComponent(e.id)}`,
      at: new Date(e.timestampMs).toISOString(),
    }));
}

export async function gatherCaptureContext(text: string, excludeTaskId?: string): Promise<CaptureContext> {
  const keywords = captureKeywords(text);
  if (keywords.length === 0) return { notes: [], prs: [], tasks: [], alerts: [] };

  // Notes matching more of the keywords rank first; one generic hit is weak evidence.
  const notesRoot = getNotesDir();
  const hits = new Map<string, { excerpt: string; score: number }>();
  for (const keyword of keywords) {
    for (const hit of searchNotes(notesRoot, keyword, { includeTldraw: false, limit: 20 })) {
      const rel = hit.path.replace(/\.json$/, "");
      if (rel.startsWith("task-notes/")) continue;
      const prev = hits.get(rel);
      hits.set(rel, { excerpt: prev?.excerpt ?? hit.text.slice(0, 120), score: (prev?.score ?? 0) + 1 });
    }
  }
  const notes = [...hits.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([rel, { excerpt }]) => ({ path: rel, excerpt }));

  const cache = readGithubPrsListCache();
  const prs = [...(cache?.authored ?? []), ...(cache?.reviews ?? []), ...(cache?.recentlyReviewed ?? [])]
    .filter((pr) => matchesAny(`${pr.title} ${pr.repo}`, keywords))
    .slice(0, MAX_PER_KIND)
    .map((pr) => ({ url: pr.url, title: pr.title, repo: pr.repo }));

  const tasks: CaptureContext["tasks"] = [];
  for (const day of listTaskDays()) {
    for (const task of day.tasks) {
      if (task.id === excludeTaskId || task.movedAt || !matchesAny(task.text, keywords)) continue;
      tasks.push({
        text: task.text,
        date: day.date,
        state: task.done ? "done" : task.abandonedAt ? "abandoned" : "open",
      });
    }
    if (tasks.length >= MAX_PER_KIND) break;
  }

  return {
    notes: notes.slice(0, MAX_PER_KIND),
    prs,
    tasks: tasks.slice(0, MAX_PER_KIND),
    alerts: await recentAlerts(keywords),
  };
}

export function buildCaptureSection(detail: string | undefined, context: CaptureContext): string {
  const lines: string[] = [];
  if (detail?.trim()) lines.push("## Captured", "", detail.trim(), "");
  lines.push("## Context snapshot", "");
  const empty = !context.notes.length && !context.prs.length && !context.tasks.length && !context.alerts.length;
  if (empty) lines.push("- Nothing related found at capture time.");
  for (const n of context.notes) lines.push(`- Note [${n.path}](/notes/${n.path}) — ${n.excerpt}`);
  for (const p of context.prs) lines.push(`- PR [${p.repo}: ${p.title}](${p.url})`);
  for (const t of context.tasks) lines.push(`- Related task (${t.date}, ${t.state}): ${t.text}`);
  for (const a of context.alerts) lines.push(`- Alert [${a.title}](${a.url}) at ${a.at}`);
  lines.push("", "## Open questions", "", "- [ ] ", "");
  return lines.join("\n");
}

export interface CaptureInput {
  text: string;
  detail?: string;
  date?: string;
  links?: EntityRef[];
}

export interface CaptureResult {
  task: Task;
  date: string;
  notePath: string;
  context: CaptureContext;
}

/** Create a draft task and its note with the context snapshot. */
export async function captureDraftTask(input: CaptureInput): Promise<CaptureResult> {
  const date = input.date ?? todayISO();
  const task = await addTask(input.text.trim(), date, undefined, input.links, "draft");
  const context = await gatherCaptureContext(`${input.text} ${input.detail ?? ""}`, task.id).catch(
    (): CaptureContext => ({ notes: [], prs: [], tasks: [], alerts: [] }),
  );
  const source = { id: task.id, text: task.text, date, jiraKey: task.jiraKey };
  const notePath = taskNotePath(source);
  const file = path.join(getNotesDir(), `${notePath}.json`);
  if (!fs.existsSync(file)) {
    const markdown = `${buildTaskNoteMarkdown(source).trimEnd()}\n\n${buildCaptureSection(input.detail, context)}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await writeAtomic(file, JSON.stringify(textToBlocks(markdown), null, 2));
  }
  return { task, date, notePath, context };
}
