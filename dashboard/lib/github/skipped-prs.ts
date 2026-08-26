// Skipped review-requested PRs. Skipping hides a PR from the "Review requested"
// list until GitHub reports a newer `updated_at` for it (new commit, comment,
// re-request, etc.) — then it resurfaces on its own and the skip is forgotten.
//
// Stored as a small JSON file in the notes config directory so it survives
// restarts and syncs with the repo.
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import type { GithubPrRow } from "@/lib/github/prs";

export interface SkippedPrRecord {
  url: string;
  /** updatedAt captured when the PR was skipped; resurface check compares against this */
  updatedAt: string;
  repo: string;
  number: number;
  title: string;
  skippedAt: string;
}

interface SkippedPrsFile {
  version: 1;
  skipped: Record<string, SkippedPrRecord>;
}

const EMPTY: SkippedPrsFile = { version: 1, skipped: {} };

function filePath(): string {
  return path.join(getNotesDir(), ".config", "skipped-prs.json");
}

function readSkipped(): Record<string, SkippedPrRecord> {
  const stored = safeReadJSON<SkippedPrsFile>(filePath(), EMPTY).skipped ?? {};
  // Tolerate the brief string-valued shape from before records carried metadata.
  for (const [url, v] of Object.entries(stored)) {
    if (typeof v === "string") stored[url] = { url, updatedAt: v, repo: "", number: 0, title: "", skippedAt: "" };
  }
  return stored;
}

async function writeSkipped(skipped: Record<string, SkippedPrRecord>): Promise<void> {
  const file = filePath();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify({ version: 1, skipped } satisfies SkippedPrsFile, null, 2));
  });
}

export async function skipPr(row: Pick<GithubPrRow, "url" | "updatedAt" | "repo" | "number" | "title">): Promise<void> {
  const skipped = readSkipped();
  skipped[row.url] = {
    url: row.url,
    updatedAt: row.updatedAt ?? "",
    repo: row.repo,
    number: row.number,
    title: row.title,
    skippedAt: new Date().toISOString(),
  };
  await writeSkipped(skipped);
}

export async function unskipPr(url: string): Promise<void> {
  const skipped = readSkipped();
  delete skipped[url];
  await writeSkipped(skipped);
}

/** Skips sorted newest first — for the /prs "Skipped" tab. */
export function listSkippedPrs(): SkippedPrRecord[] {
  return Object.values(readSkipped()).sort((a, b) => b.skippedAt.localeCompare(a.skippedAt));
}

/**
 * Drop reviews that were skipped and haven't changed since. A PR that came back
 * (updatedAt moved on) is un-skipped for good and its entry is pruned here.
 */
export async function applySkippedPrs(rows: GithubPrRow[]): Promise<GithubPrRow[]> {
  const skipped = readSkipped();
  if (Object.keys(skipped).length === 0) return rows;
  let dirty = false;
  const visible = rows.filter((r) => {
    const entry = skipped[r.url];
    if (!entry) return true;
    if (entry.updatedAt !== r.updatedAt) {
      delete skipped[r.url];
      dirty = true;
      return true;
    }
    return false;
  });
  if (dirty) await writeSkipped(skipped);
  return visible;
}
