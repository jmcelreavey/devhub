/**
 * Server-side tag read model: list, lookup, rename.
 *
 * Tags are derived, never stored — `#auth` typed in a task or note IS the tag.
 * So every operation here is a scan:
 *
 *   - Tasks come from a live walk of the tasks dir (cheap, always fresh).
 *   - Notes/docs/events come from the recall index (tag refs are extracted at
 *     chunk time), which is why a fresh machine sees task tags immediately and
 *     note tags after the index builds (~160ms, automatic on first query).
 *
 * Rename is the one write path: a bounded token replace across task texts and
 * note block text. It rewrites `#old` → `#new` with a boundary lookahead so
 * `#auth` never mangles `#auth-old`.
 */
import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "@/lib/atomic-write";
import { extractTags, type EntityRef } from "@/lib/entity-note";
import { getTasksDir } from "@/lib/content/dirs";
import { buildGraph, neighbours } from "@/lib/recall/graph";
import { loadIndex } from "@/lib/recall/store";
import { getStorage } from "@/lib/storage-server";

/** Same shape as the extraction regex — one validation, no drift. */
export const TAG_TOKEN_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

export interface TagCount {
  id: string;
  count: number;
}

export interface TaggedTask {
  date: string;
  id: string;
  text: string;
  done: boolean;
}

export interface TaggedNote {
  title: string;
  href: string;
}

export interface TagLookup {
  tag: string;
  tasks: TaggedTask[];
  notes: TaggedNote[];
  /** PRs and Jira keys the derived graph ties to this tag. */
  related: EntityRef[];
}

interface TaskFile {
  date: string;
  tasks: Array<{ id?: string; text?: string; done?: boolean }>;
}

function walkTaskFiles(): TaskFile[] {
  const dir = getTasksDir();
  const out: TaskFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, entry.name), "utf8"),
      ) as unknown;
      if (!Array.isArray(parsed)) continue;
      out.push({ date: entry.name.replace(/\.json$/, ""), tasks: parsed });
    } catch {
      /* skip corrupt day files */
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function tagCountsFromTasks(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of walkTaskFiles()) {
    for (const task of file.tasks) {
      if (typeof task.text !== "string") continue;
      for (const tag of extractTags(task.text)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Tag nodes from the derived graph (notes, docs, events, tasks at index time). */
function tagCountsFromIndex(): Map<string, number> {
  const counts = new Map<string, number>();
  try {
    const index = loadIndex();
    if (!index) return counts;
    const graph = buildGraph(index.chunks, { minWeight: 1 });
    for (const node of graph.nodes) {
      if (node.ref.kind === "tag") counts.set(node.ref.id, node.mentions);
    }
  } catch {
    /* no index yet — task tags still work */
  }
  return counts;
}

/**
 * All known tags with rough usage counts, filtered by substring when given.
 * Sources are merged with max(), not sum(): a task counted live is usually
 * also inside the index, and summing would double it.
 */
export function listTags(q?: string): TagCount[] {
  const live = tagCountsFromTasks();
  const indexed = tagCountsFromIndex();
  const merged = new Map<string, number>();
  for (const [id, count] of [...live, ...indexed]) {
    merged.set(id, Math.max(merged.get(id) ?? 0, count));
  }
  const needle = q?.trim().toLowerCase();
  return [...merged.entries()]
    .filter(([id]) => !needle || id.includes(needle))
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** Everything tied to one tag, for the work-page context card. */
export function lookupTag(id: string): TagLookup {
  const key = `tag:${id}`;
  const tasks: TaggedTask[] = [];
  for (const file of walkTaskFiles()) {
    for (const task of file.tasks) {
      if (typeof task.text !== "string" || typeof task.id !== "string") continue;
      if (!extractTags(task.text).includes(id)) continue;
      tasks.push({
        date: file.date,
        id: task.id,
        text: task.text,
        done: task.done === true,
      });
      if (tasks.length >= 20) break;
    }
    if (tasks.length >= 20) break;
  }

  const notes: TaggedNote[] = [];
  const related: EntityRef[] = [];
  try {
    const index = loadIndex();
    if (index) {
      const seenSources = new Set<string>();
      for (const chunk of index.chunks) {
        if (!chunk.refs.includes(key)) continue;
        if (chunk.sourceKind === "note" || chunk.sourceKind === "learning" || chunk.sourceKind === "doc") {
          if (seenSources.has(chunk.sourceId)) continue;
          seenSources.add(chunk.sourceId);
          notes.push({ title: chunk.title, href: chunk.href ?? `/notes/${chunk.sourceId}` });
          if (notes.length >= 12) break;
        }
      }
      const graph = buildGraph(index.chunks, { minWeight: 1 });
      for (const n of neighbours(graph, key, 10)) {
        const ref = n.node.ref;
        // Notes and tasks render in their own groups; commits aren't navigable.
        if (ref.kind === "tag" || ref.kind === "note" || ref.kind === "task" || ref.kind === "repo") {
          continue;
        }
        related.push(ref);
      }
    }
  } catch {
    /* index-less lookup still returns tasks */
  }

  return { tag: id, tasks, notes, related };
}

function replaceInBlocks(blocks: unknown[], re: RegExp, to: string): number {
  let replaced = 0;
  const walk = (list: unknown[]): void => {
    for (const raw of list) {
      const b = raw as Record<string, unknown>;
      if (Array.isArray(b.content)) {
        for (const inline of b.content as Record<string, unknown>[]) {
          if (typeof inline.text === "string") {
            const next = inline.text.replace(re, (_m, lead: string) => `${lead}#${to}`);
            if (next !== inline.text) {
              inline.text = next;
              replaced += 1;
            }
          }
        }
      }
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(blocks);
  return replaced;
}

export interface TagRenameResult {
  filesChanged: number;
  replacements: number;
}

/**
 * Rename a tag everywhere: note bodies via vault storage (atomic, codec-aware)
 * and task texts via direct day-file rewrite. Boundary-lookahead replace, so
 * `#auth` → `#authentication` leaves `#auth-old` alone.
 */
export async function renameTag(from: string, to: string): Promise<TagRenameResult> {
  if (!TAG_TOKEN_RE.test(from) || !TAG_TOKEN_RE.test(to)) {
    throw new Error("Tags are lowercase letters/digits/-/_ up to 32 chars, starting with a letter or _");
  }
  if (from === to) return { filesChanged: 0, replacements: 0 };

  // Leading boundary (start/whitespace/open-paren) + trailing lookahead, so
  // "#525" never matches and "#auth" never eats "#auth-old". Fresh RegExp per
  // call — module-level /g regexes share lastIndex state across calls.
  const re = new RegExp(`(^|[\\s(])#${from}(?![a-z0-9_-])`, "g");

  let filesChanged = 0;
  let replacements = 0;

  const storage = getStorage();
  for (const notePath of storage.getAllVaultFiles()) {
    const file = storage.read(notePath);
    const blocks = (file as { content?: unknown } | null)?.content;
    if (!Array.isArray(blocks)) continue;
    const replaced = replaceInBlocks(blocks, re, to);
    if (replaced > 0) {
      storage.write(notePath, blocks);
      filesChanged += 1;
      replacements += replaced;
    }
  }

  const tasksDir = getTasksDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const full = path.join(tasksDir, entry.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    let replaced = 0;
    for (const task of parsed as Record<string, unknown>[]) {
      if (typeof task.text !== "string") continue;
      const next = task.text.replace(re, (_m, lead: string) => `${lead}#${to}`);
      if (next !== task.text) {
        task.text = next;
        replaced += 1;
      }
    }
    if (replaced > 0) {
      // Same serialization as tasks storage (pretty, no trailing newline) so a
      // rename doesn't reformat the whole day file.
      await writeAtomic(full, JSON.stringify(parsed, null, 2));
      filesChanged += 1;
      replacements += replaced;
    }
  }

  return { filesChanged, replacements };
}
