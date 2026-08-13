/**
 * Turning DevHub's scattered content into one retrievable corpus.
 *
 * Five readers, one output shape. Each is independently failure-tolerant: a
 * missing docs directory or an unparseable note removes that content from the
 * index and nothing else. The corpus is rebuilt from scratch cheaply enough
 * (~300 notes in well under a second) that incremental invalidation lives at
 * the file level in `store.ts` rather than being smeared through here.
 */
import fs from "node:fs";
import path from "node:path";
import {
  detectJsonFileType,
  extractPlainTextFromBlockNote,
  extractPlainTextFromTldraw,
} from "@shared/notes-search/extract.ts";
import { getDocsDir, getNotesDir, getTasksDir } from "@/lib/notes/dir";
import { entityKey } from "@/lib/entity-note";
import { chunkText } from "./chunk";
import { extractRefKeys } from "./refs";
import { readEvents } from "./events";
import type { RecallChunk, RecallSourceKind } from "./types";

/** How many events to fold into the corpus. Beyond this they're history, not context. */
const EVENT_LIMIT = 4000;
/** How many days of task files to index. */
const TASK_DAYS = 400;

interface RawDoc {
  sourceKind: RecallSourceKind;
  sourceId: string;
  title: string;
  text: string;
  href?: string;
  ts: number;
  /** Refs known without reading the text (task links, event refs). */
  refs?: string[];
}

function titleFromText(text: string, fallback: string): string {
  const first = text.split("\n").find((line) => line.trim());
  if (!first) return fallback;
  return first.replace(/^#+\s*/, "").trim().slice(0, 120) || fallback;
}

function walkFiles(dir: string, predicate: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Skipping dotfiles keeps the index out of its own corpus — without this,
      // every rebuild indexes the previous rebuild's chunks.json and the
      // corpus grows without bound.
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(entry.name)) out.push(full);
    }
  }
  return out;
}

/** Notes vault: BlockNote + tldraw JSON. Learnings are tagged separately. */
function readNotes(): RawDoc[] {
  const root = getNotesDir();
  const docs: RawDoc[] = [];

  for (const file of walkFiles(root, (name) => name.endsWith(".json"))) {
    const relPath = path.relative(root, file).replace(/\.json$/, "");
    let text: string | null = null;
    let mtime = 0;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
      mtime = fs.statSync(file).mtimeMs;
      const type = detectJsonFileType(parsed);
      if (type === "tldraw") text = extractPlainTextFromTldraw(parsed);
      else if (type === "blocknote") {
        text = extractPlainTextFromBlockNote(Array.isArray(parsed) ? parsed : [parsed]);
      }
    } catch {
      continue;
    }
    if (!text || !text.trim()) continue;

    const isLearning = relPath.startsWith("learnings/");
    const isDiagram = relPath.startsWith("diagrams/");
    docs.push({
      sourceKind: isLearning ? "learning" : isDiagram ? "diagram" : "note",
      sourceId: relPath,
      title: titleFromText(text, relPath.split("/").pop() ?? relPath),
      text,
      href: `/notes/${relPath}`,
      ts: mtime,
    });
  }

  return docs;
}

/** Repo documentation: plain markdown, frontmatter stripped. */
function readDocs(): RawDoc[] {
  const root = getDocsDir();
  const docs: RawDoc[] = [];

  for (const file of walkFiles(root, (name) => name.endsWith(".md"))) {
    const relPath = path.relative(root, file).replace(/\.md$/, "");
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const mtime = fs.statSync(file).mtimeMs;
      const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
      const titleMatch = /^title:\s*(.+)$/m.exec(raw.slice(0, 600));
      if (!body.trim()) continue;
      docs.push({
        sourceKind: "doc",
        sourceId: relPath,
        title: titleMatch?.[1]?.trim() ?? titleFromText(body, relPath),
        text: body,
        href: `/docs/${relPath}`,
        ts: mtime,
      });
    } catch {
      continue;
    }
  }

  return docs;
}

/**
 * Daily task files.
 *
 * One doc per *day* rather than per task: a single task ("fix the cache purge")
 * is too short to rank on its own, and the day's other tasks are genuine
 * context for it — that's what you were doing at the time.
 */
function readTasks(): RawDoc[] {
  const root = getTasksDir();
  if (!fs.existsSync(root)) return [];

  const files = fs
    .readdirSync(root)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, TASK_DAYS);

  const docs: RawDoc[] = [];
  for (const name of files) {
    const date = name.replace(/\.json$/, "");
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, name), "utf-8")) as unknown;
      if (!Array.isArray(raw) || raw.length === 0) continue;
      const mtime = fs.statSync(path.join(root, name)).mtimeMs;

      const refs = new Set<string>();
      const lines: string[] = [];
      for (const entry of raw as Array<Record<string, unknown>>) {
        if (typeof entry.text !== "string") continue;
        const status = entry.done === true ? "done" : entry.abandonedAt ? "abandoned" : "open";
        const jira = typeof entry.jiraKey === "string" ? ` [${entry.jiraKey}]` : "";
        lines.push(`- (${status}) ${entry.text}${jira}`);
        if (Array.isArray(entry.links)) {
          for (const link of entry.links as Array<{ kind?: string; id?: string }>) {
            if (typeof link?.kind === "string" && typeof link?.id === "string") {
              refs.add(entityKey({ kind: link.kind as never, id: link.id }));
            }
          }
        }
      }
      if (lines.length === 0) continue;

      docs.push({
        sourceKind: "task",
        sourceId: date,
        title: `Tasks — ${date}`,
        text: `# Tasks ${date}\n${lines.join("\n")}`,
        href: `/work?date=${date}`,
        ts: mtime,
        refs: [...refs],
      });
    } catch {
      continue;
    }
  }

  return docs;
}

/** The event spine. Each event is one doc; they're already chunk-sized. */
function readEventDocs(): RawDoc[] {
  return readEvents({ limit: EVENT_LIMIT }).map((event) => ({
    sourceKind: "event" as const,
    sourceId: event.id,
    title: event.title,
    text: [
      `# ${event.title}`,
      `${event.kind} · ${event.source} · ${event.ts.slice(0, 10)}`,
      event.body ?? "",
      event.meta
        ? Object.entries(event.meta)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    href: event.url,
    ts: Date.parse(event.ts) || Date.now(),
    refs: (event.refs ?? []).map((ref) => entityKey(ref)),
  }));
}

export interface BuildCorpusOptions {
  kinds?: RecallSourceKind[];
}

/** Every source, chunked and ref-annotated. */
export function buildCorpus(options: BuildCorpusOptions = {}): RecallChunk[] {
  const wanted = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;

  const raw: RawDoc[] = [];
  const include = (kind: RecallSourceKind): boolean => !wanted || wanted.has(kind);

  if (include("note") || include("learning") || include("diagram")) raw.push(...readNotes());
  if (include("doc")) raw.push(...readDocs());
  if (include("task")) raw.push(...readTasks());
  if (include("event")) raw.push(...readEventDocs());

  const chunks: RecallChunk[] = [];
  for (const doc of raw) {
    if (wanted && !wanted.has(doc.sourceKind)) continue;
    for (const piece of chunkText(doc.text)) {
      const refs = new Set(doc.refs ?? []);
      // Chunk-level extraction, not document-level: an entity mentioned in one
      // paragraph should not pull in the whole file's other 30 chunks.
      for (const key of extractRefKeys(piece.text)) refs.add(key);

      chunks.push({
        id: `${doc.sourceKind}:${doc.sourceId}#${piece.ordinal}`,
        sourceKind: doc.sourceKind,
        sourceId: doc.sourceId,
        title: piece.heading && piece.ordinal > 0 ? `${doc.title} — ${piece.heading}` : doc.title,
        text: piece.text,
        href: doc.href,
        ts: doc.ts,
        refs: [...refs],
      });
    }
  }

  return chunks;
}

/**
 * Newest modification time across every source, in epoch ms.
 *
 * This is a stat-only walk — no file is opened, nothing is parsed — so it costs
 * a few milliseconds over a vault of a few hundred files and can be called on
 * every query to answer "is the index behind?".
 *
 * The earlier attempt compared the *manifest's* stored fingerprints against
 * its own `builtAt`, which is structurally incapable of noticing a new file:
 * a source that didn't exist at build time has no fingerprint to be newer
 * than. Staleness has to be measured against the filesystem, not against a
 * record of the filesystem.
 */
export function sourcesNewestMtime(): number {
  let newest = 0;

  const consider = (file: string): void => {
    try {
      newest = Math.max(newest, Math.floor(fs.statSync(file).mtimeMs));
    } catch {
      // A file that vanished between readdir and stat contributes nothing.
    }
  };

  for (const file of walkFiles(getNotesDir(), (name) => name.endsWith(".json"))) consider(file);
  for (const file of walkFiles(getDocsDir(), (name) => name.endsWith(".md"))) consider(file);

  const tasksRoot = getTasksDir();
  if (fs.existsSync(tasksRoot)) {
    for (const name of fs.readdirSync(tasksRoot)) {
      if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) consider(path.join(tasksRoot, name));
    }
  }

  // The event spine lives under a dot-directory that `walkFiles` skips by
  // design, so it has to be checked explicitly or appended events never
  // register as a change.
  const newestEvent = readEvents({ limit: 1 })[0];
  if (newestEvent) newest = Math.max(newest, Date.parse(newestEvent.ts) || 0);

  return newest;
}

/**
 * `sourceId → mtime` fingerprints, so a rebuild can detect a no-op.
 *
 * Floored to whole milliseconds because `fs.Stats.mtimeMs` is fractional while
 * `Date.parse(manifest.builtAt)` is not. Without the floor, a build that
 * completes inside the same millisecond as the last file write records a
 * fingerprint *newer* than its own `builtAt`, and `isStale()` reports a
 * freshly-built index as stale — forever, on every subsequent call.
 */
export function corpusFingerprints(chunks: readonly RecallChunk[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const chunk of chunks) {
    const key = `${chunk.sourceKind}:${chunk.sourceId}`;
    out[key] = Math.max(out[key] ?? 0, Math.floor(chunk.ts));
  }
  return out;
}
