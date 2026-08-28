/**
 * Resolve hop-around links for an entity by combining:
 *   - Stable note path conventions (task-notes / meetings / pr-reviews)
 *   - ## Links EntityRefs inside those notes
 *   - Task.links for edges that don't live in a note
 *
 * Used by /api/entity-links and (via client) EntityLinkChips / RelationsPanel.
 * MCP and plugins should prefer the shared EntityRef builders; this module is
 * the server-side read model.
 *
 * Links are stored one-way — A links to B, B is never touched — so the reverse
 * direction is reconstructed here on read. That keeps a single owner per edge
 * (unlink from the side that made it) and works retroactively on links already
 * on disk.
 */

import fs from "node:fs";
import path from "node:path";
import { getNotesDir, getTasksDir } from "@/lib/content/dirs";
import { blocksToText } from "@/lib/markdown-convert";
import {
  defaultHrefForRef,
  entityKey,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  tagRefs,
  type EntityKind,
  type EntityRef,
} from "@/lib/entity-note";
import { meetingNotePath } from "@/lib/meeting-note";
import { taskNotePath } from "@/lib/task-note";
import { prNotePath } from "@/lib/pr-note";
import { todayISO } from "@/lib/utils";
import type { Task } from "@/lib/tasks/types";

export interface EntityLinksResult {
  entity: EntityRef;
  /** Notes that represent / link to this entity. */
  notes: EntityRef[];
  /** Other entities reachable from notes + task.links. */
  related: EntityRef[];
}

export interface ResolveEntityOpts {
  date?: string;
  label?: string;
  href?: string;
  meetingTitle?: string;
  prRepo?: string;
  prNumber?: number;
}

interface TaskNode {
  task: Task;
  date: string;
}

/**
 * Every task on disk, parsed once per request.
 *
 * `findTask` and the reverse scan each used to walk the whole tasks dir, and
 * depth-2 expansion re-enters the resolver once per direct link — two walks
 * would have become N. One index threaded through is fewer reads than before,
 * and it is the only place that has to know about rollover lineage.
 */
interface TaskIndex {
  byId: Map<string, TaskNode>;
  /** rolledFromId -> id of the copy rollover made from it. */
  succ: Map<string, string>;
  all: TaskNode[];
}

function buildTaskIndex(): TaskIndex {
  const dir = getTasksDir();
  const byId = new Map<string, TaskNode>();
  const succ = new Map<string, string>();
  const all: TaskNode[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return { byId, succ, all };
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
      const node: TaskNode = { task, date };
      byId.set(task.id, node);
      all.push(node);
      if (task.rolledFromId) succ.set(task.rolledFromId, task.id);
    }
  }
  return { byId, succ, all };
}

/**
 * Every id this task has carried across rollover days.
 *
 * Rollover mints a fresh uuid per copy but leaves stored links pointing at the
 * old one, so a `task:<uuid>` edge would go dead overnight without this. Walks
 * `rolledFromId` back to the original and `succ` forward to today's copy.
 */
function taskLineageIds(idx: TaskIndex, id: string): Set<string> {
  const ids = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const prev = idx.byId.get(current)?.task.rolledFromId;
    if (prev && !ids.has(prev)) {
      ids.add(prev);
      queue.push(prev);
    }
    const next = idx.succ.get(current);
    if (next && !ids.has(next)) {
      ids.add(next);
      queue.push(next);
    }
  }
  return ids;
}

/** Newest live copy in a lineage — where a stale `task:<uuid>` ref should now point. */
function currentTaskNode(idx: TaskIndex, id: string): TaskNode | null {
  const lineage = taskLineageIds(idx, id);
  let live: TaskNode | null = null;
  let newest: TaskNode | null = null;
  for (const lid of lineage) {
    const node = idx.byId.get(lid);
    if (!node) continue;
    if (!newest || node.date > newest.date) newest = node;
    if (node.task.movedAt) continue;
    if (!live || node.date > live.date) live = node;
  }
  // A lineage of nothing but moved ghosts shouldn't drop the chip entirely.
  return live ?? newest;
}

/** Re-point a stored task ref at the live copy; rollover renamed the target. */
function freshenTaskRef(idx: TaskIndex, ref: EntityRef): EntityRef {
  if (ref.kind !== "task") return ref;
  const node = currentTaskNode(idx, ref.id);
  if (!node) return ref;
  return {
    ...ref,
    id: node.task.id,
    label: node.task.text || ref.label,
    // Beats defaultHrefForRef's generic /work?tab=tasks — a chip that lands on
    // the wrong day is barely better than a dead one.
    href: `/work?date=${node.date}`,
  };
}

function noteHref(notePath: string): string {
  return defaultHrefForRef({ kind: "note", id: notePath, label: notePath }) ?? "/notes";
}

/**
 * Absolute path for a vault-relative note, or null if it escapes the vault.
 *
 * `id` reaches here straight from the /api/entity-links query string, so
 * `../../` would otherwise read any JSON file on the box.
 */
function noteFilePath(relPath: string): string | null {
  const root = path.resolve(getNotesDir());
  const full = path.resolve(root, `${relPath}.json`);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

function noteExists(relPath: string): boolean {
  const full = noteFilePath(relPath);
  return full != null && fs.existsSync(full);
}

function readNoteMarkdown(relPath: string): string | null {
  const full = noteFilePath(relPath);
  if (!full || !fs.existsSync(full)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(full, "utf8")) as unknown;
    // Note files are the block array itself, not a `{content: [...]}` wrapper.
    const blocks = Array.isArray(raw) ? raw : (raw as { content?: unknown })?.content;
    if (!Array.isArray(blocks)) return null;
    return blocksToText(blocks as Parameters<typeof blocksToText>[0]);
  } catch {
    return null;
  }
}

/**
 * Every task whose `task.links` or `task.jiraKey` points at (kind, id) — the
 * reverse of the "task" branch below, so a Jira ticket, note, PR or *task*
 * shows what references it.
 *
 * `ids` is a set, not a single id, because a task's stored id changes at
 * rollover: a link made yesterday names yesterday's uuid.
 */
function findLinkingTasks(idx: TaskIndex, kind: EntityKind, ids: ReadonlySet<string>): EntityRef[] {
  const jiraKeys = kind === "jira" ? new Set([...ids].map((i) => i.toUpperCase())) : null;
  const out: EntityRef[] = [];
  for (const { task, date } of idx.all) {
    // Rollover leaves the prior day's task behind marked `movedAt`, with a
    // fresh id carrying the same links into today's file — skip the stale
    // copy or every linked entity shows the same task listed twice.
    if (task.movedAt) continue;
    const jiraMatch =
      jiraKeys != null && typeof task.jiraKey === "string" && jiraKeys.has(task.jiraKey.toUpperCase());
    const linkMatch = task.links?.some((l) => l.kind === kind && ids.has(l.id));
    if (!jiraMatch && !linkMatch) continue;
    out.push({ kind: "task", id: task.id, label: task.text, href: `/work?date=${date}` });
  }
  return out;
}

function listAreaNotes(area: string): string[] {
  const root = path.join(getNotesDir(), area);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".json")) {
        out.push(`${prefix}${entry.name.replace(/\.json$/, "")}`);
      }
    }
  };
  walk(root, `${area}/`);
  return out;
}

function refsFromNote(notePath: string): EntityRef[] {
  const md = readNoteMarkdown(notePath);
  if (!md) return [];
  return parseEntityLinksFromMarkdown(md).map((ref) => ({
    ...ref,
    href: defaultHrefForRef(ref) ?? ref.href,
  }));
}

/**
 * Resolve links for a given entity. Cheap path: check stable note path first,
 * then scan area notes that mention the entity id (bounded).
 */
export function resolveEntityLinks(
  kind: EntityKind,
  id: string,
  opts?: ResolveEntityOpts,
): EntityLinksResult {
  return resolveWithIndex(buildTaskIndex(), kind, id, opts);
}

function resolveWithIndex(
  idx: TaskIndex,
  kind: EntityKind,
  id: string,
  opts?: ResolveEntityOpts,
): EntityLinksResult {
  const entity: EntityRef = {
    kind,
    id,
    label: opts?.label || id,
    href: opts?.href || defaultHrefForRef({ kind, id, label: opts?.label || id }),
  };

  const notes: EntityRef[] = [];
  const related: EntityRef[] = [];

  const pushNote = (p: string, label: string) => {
    if (!noteExists(p)) return;
    notes.push({ kind: "note", id: p, label, href: noteHref(p) });
    related.push(...refsFromNote(p));
  };

  let suppressJiraKey: string | undefined;
  // For tasks the reverse scan matches the whole rollover chain, not one uuid.
  const lineage = kind === "task" ? taskLineageIds(idx, id) : new Set([id]);

  if (kind === "task") {
    const found = idx.byId.get(id) ?? null;
    const date = found?.date ?? opts?.date ?? todayISO();
    const text = found?.task.text ?? opts?.label ?? id;
    suppressJiraKey = found?.task.jiraKey;
    // Companion note chip sits under the task title — don't re-echo the title.
    pushNote(taskNotePath({ id, text, date }), "Note");
    if (found?.task.links?.length) {
      related.push(...found.task.links.map((l) => freshenTaskRef(idx, l)));
    }
    // Free-form #tags typed in the task text are links too — they show as
    // chips and hop to a filtered work view.
    related.push(...tagRefs(text));
    // Do not auto-emit the task's own jiraKey as a related chip: the task row
    // already has JiraKeyChip (copy) + open-in-Jira. Explicit jira links in
    // task.links (a different key) still flow through above. Same-key refs
    // scraped from the companion note are stripped below.
  } else if (kind === "calendar" || kind === "meeting") {
    const title = opts?.meetingTitle || opts?.label || id;
    const start = opts?.date ? `${opts.date}T00:00:00` : `${todayISO()}T00:00:00`;
    pushNote(
      meetingNotePath({ title, start, end: start }),
      title.slice(0, 48) || "Meeting note",
    );
    // Also scan meetings/ for notes that mention this calendar id
    for (const p of listAreaNotes("meetings")) {
      const refs = refsFromNote(p);
      if (refs.some((r) => r.kind === "calendar" && (r.id === id || r.href === id))) {
        notes.push({ kind: "note", id: p, label: p.split("/").pop() || p, href: noteHref(p) });
        related.push(...refs);
      }
    }
  } else if (kind === "pr") {
    const repo = opts?.prRepo;
    const number = opts?.prNumber;
    if (repo && number != null) {
      pushNote(prNotePath({ repo, number }), `${repo}#${number}`);
    } else {
      // id form owner/repo#n
      const m = id.match(/^([^/#]+\/[^/#]+)#(\d+)$/);
      if (m) pushNote(prNotePath({ repo: m[1], number: Number(m[2]) }), id);
    }
  } else if (kind === "note") {
    notes.push({ kind: "note", id, label: opts?.label || id, href: noteHref(id) });
    const md = readNoteMarkdown(id);
    if (md) {
      related.push(
        ...parseEntityLinksFromMarkdown(md).map((ref) => ({
          ...ref,
          href: defaultHrefForRef(ref) ?? ref.href,
        })),
      );
      // Inline #tags in the note body show up as hop chips in the
      // relations panel, same as task tags.
      related.push(...tagRefs(md));
    }
  } else if (kind === "jira") {
    pushNote(`tickets/${id}`, id);
  }

  // Any task that links to (or has jiraKey ==) this entity — the reverse of
  // the "task" branch's own task.links read above. Tasks included: a task
  // linked to another task should say so from both ends.
  related.push(...findLinkingTasks(idx, kind, lineage));

  // Deduplicate notes/related excluding the queried entity itself — for a task
  // that means every id in its lineage, or yesterday's copy shows as related.
  const selfKeys = new Set([...lineage].map((lid) => entityKey({ kind, id: lid })));
  const suppress = suppressJiraKey?.toUpperCase();
  return {
    entity,
    notes: mergeEntityRefs(notes),
    related: mergeEntityRefs(related).filter((r) => {
      if (selfKeys.has(entityKey(r))) return false;
      if (suppress && r.kind === "jira" && r.id.toUpperCase() === suppress) return false;
      return true;
    }),
  };
}

export interface EntityContextResult extends EntityLinksResult {
  /** One hop past `related` — what the direct links themselves link to. */
  expanded: EntityRef[];
}

/**
 * Kinds worth another hop. `repo` and `tag` are deliberately excluded: they fan
 * out to every task that ever touched them, which is a listing, not context.
 */
const EXPANDABLE_KINDS: ReadonlySet<EntityKind> = new Set(["note", "task", "jira", "pr"]);

const DEFAULT_MAX_EXPANDED = 25;

/**
 * `resolveEntityLinks` plus, at depth 2, what each direct link links to.
 *
 * Built for agents: the implement plan hands over the whole neighbourhood in
 * one response so a skill doesn't crawl it with N sequential MCP round-trips
 * (and stop at depth 1 anyway). Depth 1 is the default, so chip callers are
 * unchanged.
 */
export function resolveEntityContext(
  kind: EntityKind,
  id: string,
  opts?: ResolveEntityOpts & { depth?: number; maxRefs?: number },
): EntityContextResult {
  const idx = buildTaskIndex();
  const base = resolveWithIndex(idx, kind, id, opts);
  if ((opts?.depth ?? 1) < 2) return { ...base, expanded: [] };

  const maxRefs = opts?.maxRefs ?? DEFAULT_MAX_EXPANDED;
  const seen = new Set<string>([entityKey(base.entity)]);
  for (const ref of [...base.notes, ...base.related]) seen.add(entityKey(ref));

  const expanded: EntityRef[] = [];
  for (const ref of base.related) {
    if (expanded.length >= maxRefs) break;
    if (!EXPANDABLE_KINDS.has(ref.kind)) continue;
    const hop = resolveWithIndex(idx, ref.kind, ref.id, { label: ref.label, href: ref.href });
    for (const next of mergeEntityRefs(hop.notes, hop.related)) {
      if (expanded.length >= maxRefs) break;
      const key = entityKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push(next);
    }
  }

  return { ...base, expanded: mergeEntityRefs(expanded) };
}
