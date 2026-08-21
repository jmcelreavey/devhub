import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/content/dirs";
import { buildReviewNoteRef, type ReviewNoteRef } from "@/lib/notes/review-index";

/** Review notes live in one conventional folder inside the notes vault. */
const REVIEW_DIR = "pr-reviews";

interface CachedIndex {
  notes: ReviewNoteRef[];
  /** Newest mtime seen when the index was built. */
  stamp: number;
  count: number;
}

let cache: CachedIndex | null = null;

function reviewDirPath(): string {
  return path.join(getNotesDir(), REVIEW_DIR);
}

/**
 * Cheap fingerprint of the folder: file count plus newest mtime.
 *
 * Reading and parsing 28 BlockNote documents on every commit hover would be
 * daft; stat-ing them is not. Editing a note changes its mtime, adding or
 * deleting one changes the count, so both invalidate.
 */
function fingerprint(dir: string): { stamp: number; count: number; files: string[] } {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return { stamp: 0, count: 0, files: [] };
  }
  let stamp = 0;
  for (const name of names) {
    try {
      stamp = Math.max(stamp, fs.statSync(path.join(dir, name)).mtimeMs);
    } catch {
      // vanished mid-scan — the count change will invalidate anyway
    }
  }
  return { stamp, count: names.length, files: names };
}

/** Parsed, cached index of every PR-review note. Never throws. */
export function getReviewNoteIndex(): ReviewNoteRef[] {
  const dir = reviewDirPath();
  const { stamp, count, files } = fingerprint(dir);
  if (cache && cache.stamp === stamp && cache.count === count) return cache.notes;

  const notes: ReviewNoteRef[] = [];
  for (const name of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), "utf8");
      notes.push(buildReviewNoteRef(`${REVIEW_DIR}/${name}`, JSON.parse(raw)));
    } catch {
      // A single unparseable note must not take the whole feature down.
    }
  }

  cache = { notes, stamp, count };
  return notes;
}

/**
 * File activity (max of mtime / birthtime) keyed by vault-relative path,
 * e.g. `pr-reviews/acme-app-1.json`. Stats only — does not parse note bodies.
 */
export function reviewNoteActivityByPath(): Map<string, number> {
  const dir = reviewDirPath();
  const { files } = fingerprint(dir);
  const map = new Map<string, number>();
  for (const name of files) {
    try {
      const st = fs.statSync(path.join(dir, name));
      const birth = Number.isFinite(st.birthtimeMs) ? st.birthtimeMs : 0;
      map.set(`${REVIEW_DIR}/${name}`, Math.max(st.mtimeMs, birth));
    } catch {
      // vanished mid-scan
    }
  }
  return map;
}

/** Test seam — drops the memoised index. */
export function resetReviewNoteIndexCache(): void {
  cache = null;
}
