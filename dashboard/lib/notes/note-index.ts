import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/content/dirs";
import { isDiagramStoragePath, toDiagramRoutePath } from "@/lib/diagram-utils";
import { parseCommitRefs } from "@/lib/git/commit-refs";
import {
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
  /**
   * The day a note is about: the `YYYY-MM-DD` its filename starts with, else
   * its mtime. Mtime alone is not enough — a sync that rewrites the vault
   * stamps every note with the same second, and "newest first" turns random.
   */
  date: number;
  /** True for tldraw canvases, which have no text to derive from. */
  isDiagram: boolean;
}

export interface NoteSection {
  /** Null for notes that fit no section. Always last; area pages call it "Other". */
  label: string | null;
  notes: NoteSummary[];
}

export interface NoteAreaGroup {
  meta: NoteAreaMeta;
  /** Newest first. */
  notes: NoteSummary[];
  /**
   * The same notes split by real subfolder or `meta.groupBy`. A single
   * unlabelled section when there is nothing worth splitting on.
   */
  sections: NoteSection[];
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

/** A note plus what grouping needs and the UI does not. */
interface IndexedNote {
  note: NoteSummary;
  /** Repo a review note is about, from a `repo#123` line or a PR link. */
  repo?: string;
  prNumber?: number;
}

let cache: CacheEntry | null = null;

/** Folders that hold machine state rather than notes. */
const SKIP_DIRS = new Set([".cache", ".trash", "assets"]);

const DAY_MS = 86_400_000;

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

const DATED_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:-(.*))?$/;

/** Local midnight of a `2026-07-27…` filename, or undefined. */
function filenameDate(base: string): number | undefined {
  const dated = DATED_NAME_RE.exec(base);
  if (!dated) return undefined;
  const time = new Date(Number(dated[1]), Number(dated[2]) - 1, Number(dated[3])).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function prettifyFilename(base: string): string {
  // Date-named notes (2026-07-27, 2026-07-27-standup) read better as prose.
  const dated = DATED_NAME_RE.exec(base);
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

interface InlineNode {
  text?: unknown;
  href?: unknown;
  content?: unknown;
}

interface BlockNode {
  type?: unknown;
  props?: { level?: unknown };
  content?: unknown;
}

/** What a block reads as on screen: link text kept, markup and hrefs dropped. */
function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as InlineNode[])
    .map((node) => (typeof node.text === "string" ? node.text : inlineText(node.content)))
    .join("");
}

const PR_URL_RE = /github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/;

function prLinkIn(content: unknown): { repo: string; prNumber: number } | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const node of content as InlineNode[]) {
    const source = typeof node.href === "string" ? node.href : inlineText([node]);
    const match = PR_URL_RE.exec(source);
    if (match) return { repo: match[1].toLowerCase(), prNumber: Number(match[2]) };
  }
  return undefined;
}

/**
 * The line review notes put under their title: `capi#673`, `owner/repo#73`,
 * `PR: owner/repo#38`, or `atlas@branch-name` for a pre-PR branch review.
 */
const REF_LINE_RE = /^(?:PR:\s*)?(?:[\w.-]+\/)?([\w.-]+)(?:#(\d+)|@[\w./-]+)$/i;

/** Labelled lines that describe a note rather than summarise it. */
const METADATA_LINE_RE =
  /^(?:date|tags?|jira|tickets?|repo(?:sitory)?|branch|pr|status|created|updated|owner|author)\s*:/i;

/** Placeholder paragraphs like `-` or `…` have nothing to read. */
const HAS_WORDS_RE = /[\p{L}\p{N}]/u;

/** Trailing `#tag #tag` runs are for search; in a list they are noise. */
const TRAILING_TAGS_RE = /(?:\s+#[a-z][\w-]*)+\s*$/i;

function readableTitle(raw: string): string {
  const title = raw.trim();
  return title.replace(TRAILING_TAGS_RE, "").trim() || title;
}

interface Derived {
  title?: string;
  summary?: string;
  repo?: string;
  prNumber?: number;
}

/**
 * First heading as title, first descriptive paragraph as summary, plus the repo
 * a review note is about. Reads blocks rather than serialised markdown so link
 * syntax and `::directives` never leak into a list row.
 */
function deriveFromBlocks(raw: string): Derived {
  let blocks: BlockNode[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    blocks = (Array.isArray(parsed) ? parsed : [parsed]) as BlockNode[];
  } catch {
    return {};
  }

  const derived: Derived = {};
  let firstParagraph = true;
  // `## Links` holds entity refs (`Task: …`, `Repo: …`) — never a summary.
  let inLinks = false;
  let prLink: { repo: string; prNumber: number } | undefined;

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    prLink ??= prLinkIn(block.content);
    const text = inlineText(block.content).replace(/\s+/g, " ").trim();
    if (!text) continue;

    if (block.type === "heading") {
      const level = typeof block.props?.level === "number" ? block.props.level : 1;
      if (!derived.title && level <= 3) derived.title = readableTitle(text);
      else inLinks = text.toLowerCase() === "links";
      continue;
    }
    if (block.type !== "paragraph" || inLinks || !HAS_WORDS_RE.test(text)) continue;

    if (firstParagraph) {
      firstParagraph = false;
      const ref = REF_LINE_RE.exec(text);
      if (ref) {
        derived.repo = ref[1].toLowerCase();
        if (ref[2]) derived.prNumber = Number(ref[2]);
        continue;
      }
    }
    if (!derived.summary && !METADATA_LINE_RE.test(text)) {
      derived.summary = text.length > 150 ? `${text.slice(0, 147).trimEnd()}…` : text;
    }
  }

  if (!derived.repo && prLink) {
    derived.repo = prLink.repo;
    derived.prNumber = prLink.prNumber;
  }
  return derived;
}

function toIndexed(root: string, rel: string): IndexedNote | null {
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

  let derived: Derived = {};
  if (!isDiagram) {
    try {
      derived = deriveFromBlocks(fs.readFileSync(abs, "utf8"));
    } catch {
      derived = {};
    }
  }

  return {
    note: {
      slug,
      href: isDiagram ? toDiagramRoutePath(slug) : `/notes/${slug}`,
      title: derived.title || prettifyFilename(base),
      summary: derived.summary,
      area: areaIdForSlug(slug),
      modified,
      date: filenameDate(base) ?? modified,
      isDiagram,
    },
    repo: derived.repo,
    prNumber: derived.prNumber,
  };
}

/** Monday 00:00 local time of the week containing `now`. */
function startOfWeek(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

function periodLabel(date: number, weekStart: number): string {
  if (date >= weekStart) return "This week";
  const lastWeek = new Date(weekStart);
  lastWeek.setDate(lastWeek.getDate() - 7);
  if (date >= lastWeek.getTime()) return "Last week";
  return MONTH_FORMAT.format(new Date(date));
}

/** `discovery/PTF-4897-app-inventory` — the naming convention wins over the title. */
const TICKET_NAME_RE = /^([A-Za-z][A-Za-z0-9]{1,5}-\d{1,6})(?:-|$)/;

function ticketFor(note: NoteSummary): string | undefined {
  const base = note.slug.split("/").pop() ?? "";
  const named = TICKET_NAME_RE.exec(base)?.[1];
  return named ? named.toUpperCase() : parseCommitRefs(note.title).tickets[0];
}

type SectionKind = "folder" | "repo" | "ticket" | "period";

function sectionFor(
  entry: IndexedNote,
  meta: NoteAreaMeta,
  weekStart: number,
): { kind: SectionKind; label: string } | null {
  const parts = entry.note.slug.split("/");
  if (parts.length > 2) return { kind: "folder", label: parts[1] };
  if (meta.groupBy === "repo") return entry.repo ? { kind: "repo", label: entry.repo } : null;
  if (meta.groupBy === "ticket") {
    const ticket = ticketFor(entry.note);
    return ticket ? { kind: "ticket", label: ticket } : null;
  }
  if (meta.groupBy === "period") {
    return { kind: "period", label: periodLabel(entry.note.date, weekStart) };
  }
  return null;
}

/**
 * Same day, then PR number, then mtime. The day comes first so a note edited
 * today beats a stale one; the PR number is there because a vault-wide rewrite
 * gives every untouched review the same mtime, and #14622 is newer than #14500.
 */
function newestFirst(a: IndexedNote, b: IndexedNote): number {
  return (
    Math.floor(b.note.date / DAY_MS) - Math.floor(a.note.date / DAY_MS) ||
    (b.prNumber ?? 0) - (a.prNumber ?? 0) ||
    b.note.modified - a.note.modified ||
    a.note.title.localeCompare(b.note.title)
  );
}

interface SectionBucket {
  kind: SectionKind;
  label: string;
  entries: IndexedNote[];
}

/**
 * Kept even with one note. A gap in a timeline reads as missing notes, and a
 * PR title never says which repo it is from, so a one-off review filed under
 * "Other" loses the only context it had.
 */
const ALWAYS_KEPT = new Set<SectionKind>(["period", "repo"]);

/**
 * Branch reviews without a PR link are still named after their repo
 * (`atlas-ptf-4788-…`, `acme-capi-525`). Only repos other notes
 * already named are tried — splitting hyphenated names blind is guesswork.
 */
function inferReposFromFilenames(entries: IndexedNote[]): void {
  const known = [...new Set(entries.flatMap((entry) => (entry.repo ? [entry.repo] : [])))]
    // Longest first, so `app-poc-…` is not filed under `app`.
    .sort((a, b) => b.length - a.length);
  for (const entry of entries) {
    if (entry.repo) continue;
    const base = (entry.note.slug.split("/").pop() ?? "").toLowerCase();
    entry.repo = known.find((repo) => base.startsWith(`${repo}-`) || base.includes(`-${repo}-`));
  }
}

function sectionsFor(entries: IndexedNote[], meta: NoteAreaMeta, weekStart: number): NoteSection[] {
  if (meta.groupBy === "repo") inferReposFromFilenames(entries);
  const buckets = new Map<string, SectionBucket>();
  const loose: IndexedNote[] = [];
  for (const entry of entries) {
    const section = sectionFor(entry, meta, weekStart);
    if (!section) {
      loose.push(entry);
      continue;
    }
    const key = `${section.kind}:${section.label}`;
    const bucket = buckets.get(key) ?? { ...section, entries: [] };
    bucket.entries.push(entry);
    buckets.set(key, bucket);
  }

  // Outside ALWAYS_KEPT, a section with one note is a folder you open to find one file.
  const kept: SectionBucket[] = [];
  for (const bucket of buckets.values()) {
    if (ALWAYS_KEPT.has(bucket.kind) || bucket.entries.length > 1) kept.push(bucket);
    else loose.push(...bucket.entries);
  }

  // One section and nothing else is a heading that adds a click and no information.
  if (kept.length === 0 || (kept.length === 1 && loose.length === 0)) {
    return [{ label: null, notes: entries.sort(newestFirst).map((entry) => entry.note) }];
  }

  const newest = (bucket: SectionBucket) =>
    Math.max(...bucket.entries.map((entry) => entry.note.date));
  kept.sort((a, b) => {
    // Named sections A–Z like a file tree; periods newest first after them.
    if ((a.kind === "period") !== (b.kind === "period")) return a.kind === "period" ? 1 : -1;
    if (a.kind === "period") return newest(b) - newest(a);
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  });

  const sections: NoteSection[] = kept.map((bucket) => ({
    label: bucket.label,
    notes: bucket.entries.sort(newestFirst).map((entry) => entry.note),
  }));
  if (loose.length > 0) {
    sections.push({ label: null, notes: loose.sort(newestFirst).map((entry) => entry.note) });
  }
  return sections;
}

function areaRank(meta: NoteAreaMeta): number {
  if (meta.id === ROOT_AREA_ID) return 0;
  return meta.secondary ? 2 : 1;
}

function build(root: string, files: string[], weekStart: number): NoteIndex {
  const entries = files
    .map((rel) => toIndexed(root, rel))
    .filter((entry): entry is IndexedNote => entry !== null);

  const grouped = new Map<string, IndexedNote[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.note.area) ?? [];
    list.push(entry);
    grouped.set(entry.note.area, list);
  }

  const areas: NoteAreaGroup[] = [...grouped.entries()]
    .map(([id, list]) => {
      const meta = getAreaMeta(id);
      return {
        meta,
        // Newest first: notes are a journal, not a manual.
        notes: list.map((entry) => entry.note).sort((a, b) => b.modified - a.modified),
        sections: sectionsFor([...list], meta, weekStart),
      };
    })
    // Busiest first, so the areas you actually write to lead and the ones you
    // don't sink. Loose root notes stay on top — they are waiting to be filed.
    .sort(
      (a, b) =>
        areaRank(a.meta) - areaRank(b.meta) ||
        b.notes.length - a.notes.length ||
        a.meta.order - b.meta.order ||
        a.meta.label.localeCompare(b.meta.label),
    );

  const notes = entries.map((entry) => entry.note);
  return { notes, areas, total: notes.length };
}

function load(): NoteIndex {
  const root = getNotesDir();
  const files = walk(root).sort();
  // "This week" moves on without any file changing, so the week is part of the key.
  const weekStart = startOfWeek(Date.now());
  const signature = `${weekStart}|${signatureFor(root, files)}`;
  if (cache && cache.signature === signature) return cache.index;
  const index = build(root, files, weekStart);
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
  sections: NoteSection[];
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
    sections: group.sections,
    prev: position > 0 ? index.areas[position - 1].meta : null,
    next: position < index.areas.length - 1 ? index.areas[position + 1].meta : null,
  };
}
