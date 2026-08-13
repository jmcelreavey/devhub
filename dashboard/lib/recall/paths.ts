/**
 * Where the recall layer keeps its bytes.
 *
 * Everything lives under `<notes>/.index/` for one reason: the notes vault
 * already skips dot-directories when it walks (`lexical.ts`, the file tree, the
 * note index all do `entry.name.startsWith(".")`), so a derived index placed
 * there is invisible to every existing consumer without touching any of them.
 *
 * Two sub-trees, different durability requirements:
 *
 *   events/  — the spine. Append-only, git-tracked, the actual new source of
 *              truth. Losing it loses history.
 *   recall/  — the index. Derived, gitignored, disposable. `rm -rf` it and the
 *              next query rebuilds it.
 *
 * Keeping them apart is what makes "the index is only a cache" a true statement
 * rather than an aspiration.
 */
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";

export const RECALL_INDEX_VERSION = 1;

export function recallRoot(): string {
  return path.join(getNotesDir(), ".index");
}

/** Append-only event log directory. Durable; belongs in git. */
export function eventsDir(): string {
  return path.join(recallRoot(), "events");
}

/** Events are sharded by month so no single file grows without bound. */
export function eventsFile(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return path.join(eventsDir(), `${year}-${month}.ndjson`);
}

/** Derived index directory. Disposable; gitignored. */
export function indexDir(): string {
  return path.join(recallRoot(), "recall");
}

export function chunksFile(): string {
  return path.join(indexDir(), "chunks.json");
}

export function manifestFile(): string {
  return path.join(indexDir(), "manifest.json");
}
