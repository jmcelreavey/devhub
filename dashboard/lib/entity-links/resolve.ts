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
import { getNotesDir } from "@/lib/content/dirs";
import { blocksToText } from "@/lib/markdown-convert";
import {
  defaultHrefForRef,
  entityKey,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  type EntityKind,
  type EntityRef,
} from "@/lib/entity-note";
import { meetingNotePath } from "@/lib/meeting-note";
import { createTaskNoteResolver } from "@/lib/tasks/task-notes";
import { currentTaskNode, loadTaskIndex, taskLineageIds, type TaskIndex } from "@/lib/tasks/task-index";
import { prNotePath } from "@/lib/pr-note";
import { todayISO } from "@/lib/utils";

export interface EntityLinksResult {
  entity: EntityRef;
  /** Notes that represent / link to this entity. */
  notes: EntityRef[];
  /** Other entities reachable from notes + task.links. */
  related: EntityRef[];
  /** Legacy task IDs and their current refs, for merging client-side stored links. */
  taskAliases?: Record<string, EntityRef>;
}

export interface ResolveEntityOpts {
  date?: string;
  label?: string;
  href?: string;
  meetingTitle?: string;
  prRepo?: string;
  prNumber?: number;
}

/** Resolve legacy UUIDs and daily snapshots to the current task. */
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
 * `ids` includes legacy rollover UUIDs, so old links still match the task.
 */
function findLinkingTasks(idx: TaskIndex, kind: EntityKind, ids: ReadonlySet<string>): EntityRef[] {
  const jiraKeys = kind === "jira" ? new Set([...ids].map((i) => i.toUpperCase())) : null;
  const out: EntityRef[] = [];
  for (const { task, date } of idx.byId.values()) {
    // Ignore historical aliases, including an unmarked source left by a failed write.
    if (task.movedAt || currentTaskNode(idx, task.id)?.task.id !== task.id) continue;
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
  return resolveWithIndex(loadTaskIndex(), kind, id, opts);
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
    const found = currentTaskNode(idx, id);
    const date = found?.date ?? opts?.date ?? todayISO();
    const text = found?.task.text ?? opts?.label ?? id;
    suppressJiraKey = found?.task.jiraKey;
    // Companion note chip sits under the task title — don't re-echo the title.
    const source = found?.task ?? { id, text, done: false, createdAt: date };
    const resolved = createTaskNoteResolver()(source, date);
    pushNote(resolved.notePath, "Note");
    for (const previous of resolved.previousNotePaths) pushNote(previous, "Previous note");
    if (found?.task.links?.length) {
      related.push(...found.task.links.map((l) => freshenTaskRef(idx, l)));
    }
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
  const taskAliases = new Map<string, EntityRef>();
  for (const ref of related) {
    if (ref.kind !== "task") continue;
    const current = freshenTaskRef(idx, ref);
    for (const alias of taskLineageIds(idx, ref.id)) taskAliases.set(alias, current);
  }
  return {
    taskAliases: Object.fromEntries(taskAliases),
    entity,
    notes: mergeEntityRefs(notes),
    related: mergeEntityRefs(related.map((ref) => freshenTaskRef(idx, ref))).filter((r) => {
      if (r.kind === "tag") return false;
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
  const idx = loadTaskIndex();
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
