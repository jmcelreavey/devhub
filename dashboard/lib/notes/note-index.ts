import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/content/dirs";
import { blocksToText } from "@/lib/markdown-convert";
import { isDiagramStoragePath, toDiagramRoutePath } from "@/lib/diagram-utils";
import {
  NOTE_AREAS,
  ROOT_AREA_ID,
  areaIdForSlug,
  getAreaMeta,
  type NoteAreaMeta,
} from "@/lib/notes/note-areas";

/**
 * A browsable index over the notes vault.
 *
 * Mirrors `lib/docs/doc-index.ts`, but notes are BlockNote JSON with no
 * frontmatter, so everything here is *derived*: the title comes from the first
 * heading, the summary from the first paragraph. That is why the parsed result
 * is cached on an mtime signature — deriving titles for a few hundred notes on
 * every render would make the landing page the slowest route in the app.
 */

export interface NoteSummary {
  slug: string;
  href: string;
  title: string;
  summary?: string;
  area: string;
  modified: number;
  /** True for tldraw canvases, which have no text to derive from. */
  isDiagram: boolean;
}

export interface NoteAreaGroup {
  meta: NoteAreaMeta;
  notes: NoteSummary[];
}

export interface NoteIndex {
  notes: NoteSummary[];
  areas: NoteAreaGroup[];
  total: number;
}

interface CacheEntry {
  signature: string;
  index: NoteIndex;
}

let cache: CacheEntry | null = null;

/** Folders that hold machine state rather than notes. */
const SKIP_DIRS = new Set([".cache", ".trash", "assets"]);

function walk(root: string, dir = ""): string[] {
  const abs = path.join(root, dir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(root, rel));
    } else if (entry.name.endsWith(".json") || entry.name.endsWith(".tldr")) {
      out.push(rel);
    }
  }
  return out;
}

function signatureFor(root: string, files: string[]): string {
  const parts: string[] = [];
  for (const rel of files) {
    try {
      const stat = fs.statSync(path.join(root, rel));
      parts.push(`${rel}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${rel}:missing`);
    }
  }
  return parts.join("|");
}

function prettifyFilename(base: string): string {
  // Date-named notes (2026-07-27, 2026-07-27-standup) read better as prose.
  const dated = /^(\d{4})-(\d{2})-(\d{2})(?:-(.*))?$/.exec(base);
  if (dated) {
    const [, y, m, d, rest] = dated;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    const label = Number.isNaN(date.getTime())
      ? `${y}-${m}-${d}`
      : new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(date);
    return rest ? `${label} — ${rest.replace(/-/g, " ")}` : label;
  }
  return base.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** First heading as title, first paragraph as summary. Both optional. */
function deriveFromBlocks(raw: string): { title?: string; summary?: string } {
  let text: string;
  try {
    const parsed = JSON.parse(raw) as unknown;
    text = blocksToText(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    return {};
  }
  const lines = text.split("\n");
  let title: string | undefined;
  let summary: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!title && /^#{1,3}\s/.test(trimmed)) {
      title = trimmed.replace(/^#+\s*/, "");
      continue;
    }
    if (!summary && !/^#{1,6}\s/.test(trimmed) && !/^[-*|>]/.test(trimmed)) {
      summary = trimmed.length > 150 ? `${trimmed.slice(0, 147).trimEnd()}…` : trimmed;
    }
    if (title && summary) break;
  }
  return { title, summary };
}

function toSummary(root: string, rel: string): NoteSummary | null {
  const abs = path.join(root, rel);
  let modified = 0;
  try {
    modified = fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }

  const slug = rel.replace(/\.(json|tldr)$/, "");
  const isDiagram = rel.endsWith(".tldr") || isDiagramStoragePath(slug);
  const base = slug.split("/").pop() ?? slug;

  let derived: { title?: string; summary?: string } = {};
  if (!isDiagram) {
    try {
      derived = deriveFromBlocks(fs.readFileSync(abs, "utf8"));
    } catch {
      derived = {};
    }
  }

  return {
    slug,
    href: isDiagram ? toDiagramRoutePath(slug) : `/notes/${slug}`,
    title: derived.title?.trim() || prettifyFilename(base),
    summary: derived.summary,
    area: areaIdForSlug(slug),
    modified,
    isDiagram,
  };
}

function build(root: string, files: string[]): NoteIndex {
  const notes = files
    .map((rel) => toSummary(root, rel))
    .filter((note): note is NoteSummary => note !== null);

  const grouped = new Map<string, NoteSummary[]>();
  for (const note of notes) {
    const list = grouped.get(note.area) ?? [];
    list.push(note);
    grouped.set(note.area, list);
  }

  const order = new Map(NOTE_AREAS.map((area) => [area.id, area.order]));
  const areas: NoteAreaGroup[] = [...grouped.entries()]
    .map(([id, list]) => ({
      meta: getAreaMeta(id),
      // Newest first: notes are a journal, not a manual.
      notes: list.sort((a, b) => b.modified - a.modified),
    }))
    .sort((a, b) => {
      const aOrder = a.meta.id === ROOT_AREA_ID ? 0 : (order.get(a.meta.id) ?? a.meta.order);
      const bOrder = b.meta.id === ROOT_AREA_ID ? 0 : (order.get(b.meta.id) ?? b.meta.order);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.meta.label.localeCompare(b.meta.label);
    });

  return { notes, areas, total: notes.length };
}

function load(): NoteIndex {
  const root = getNotesDir();
  const files = walk(root).sort();
  const signature = signatureFor(root, files);
  if (cache && cache.signature === signature) return cache.index;
  const index = build(root, files);
  cache = { signature, index };
  return index;
}

export function getNoteIndex(): NoteIndex {
  return load();
}

/** Drop the memoised index. Call after any write to the notes tree. */
export function invalidateNoteIndex(): void {
  cache = null;
}

export function getRecentNotes(limit = 6): NoteSummary[] {
  return [...getNoteIndex().notes]
    .sort((a, b) => b.modified - a.modified)
    .slice(0, limit);
}

/** One area's page, or null when the id is unknown or empty. */
export function getNoteAreaDetail(areaId: string): {
  meta: NoteAreaMeta;
  notes: NoteSummary[];
  prev: NoteAreaMeta | null;
  next: NoteAreaMeta | null;
} | null {
  const index = getNoteIndex();
  const position = index.areas.findIndex((area) => area.meta.id === areaId);
  if (position === -1) return null;
  const group = index.areas[position];
  if (group.notes.length === 0) return null;
  return {
    meta: group.meta,
    notes: group.notes,
    prev: position > 0 ? index.areas[position - 1].meta : null,
    next: position < index.areas.length - 1 ? index.areas[position + 1].meta : null,
  };
}
