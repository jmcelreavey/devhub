/**
 * Tracks auto agent-review starts so the poller / endpoint does not re-enqueue
 * the same PR head until it gets a new commit.
 *
 * Shape mirrors skipped-prs.json (notes/.config/). Does not auto-post GitHub
 * review comments — only records that DevHub started an agent review job.
 */
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";

export interface AutoPrReviewRecord {
  url: string;
  /** PR updatedAt captured when the review job was started. */
  updatedAt: string;
  /** Head commit reviewed — the dedupe key when known. */
  headSha?: string;
  repo: string;
  number: number;
  title: string;
  startedAt: string;
  sessionId?: string;
  notePath?: string;
}

/**
 * Has this PR head already had an auto-review? Keyed on the head SHA — comments,
 * labels and CI bump `updatedAt` without changing the code. Records from before
 * SHAs were stored fall back to `updatedAt`.
 */
export function isSameReviewedHead(
  prior: Pick<AutoPrReviewRecord, "updatedAt" | "headSha">,
  live: { updatedAt?: string; headSha?: string },
): boolean {
  if (prior.headSha && live.headSha) return prior.headSha === live.headSha;
  const updatedAt = live.updatedAt ?? "";
  return updatedAt !== "" && prior.updatedAt === updatedAt;
}

interface AutoPrReviewFile {
  version: 1;
  reviews: Record<string, AutoPrReviewRecord>;
}

const EMPTY: AutoPrReviewFile = { version: 1, reviews: {} };

function filePath(): string {
  return path.join(getNotesDir(), ".config", "auto-pr-reviews.json");
}

function readAll(): Record<string, AutoPrReviewRecord> {
  return safeReadJSON<AutoPrReviewFile>(filePath(), EMPTY).reviews ?? {};
}

/**
 * Read-modify-write under the file mutex — the poller starts reviews in
 * parallel, and reading outside the lock let the second start drop the first.
 * `mutate` returns false to skip the write.
 */
async function updateAll(mutate: (reviews: Record<string, AutoPrReviewRecord>) => boolean): Promise<void> {
  const file = filePath();
  await withMutex(file, async () => {
    const reviews = readAll();
    if (!mutate(reviews)) return;
    await writeAtomic(file, JSON.stringify({ version: 1, reviews } satisfies AutoPrReviewFile, null, 2));
  });
}

export function getAutoPrReviewRecord(url: string): AutoPrReviewRecord | undefined {
  return readAll()[url];
}

export function listAutoPrReviewRecords(): AutoPrReviewRecord[] {
  return Object.values(readAll()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function recordAutoPrReviewStart(
  row: Pick<AutoPrReviewRecord, "url" | "updatedAt" | "headSha" | "repo" | "number" | "title" | "sessionId" | "notePath">,
): Promise<void> {
  await updateAll((reviews) => {
    reviews[row.url] = {
      url: row.url,
      updatedAt: row.updatedAt ?? "",
      repo: row.repo,
      number: row.number,
      title: row.title,
      startedAt: new Date().toISOString(),
      ...(row.headSha ? { headSha: row.headSha } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.notePath ? { notePath: row.notePath } : {}),
    };
    return true;
  });
}

/** Drop entries whose PR head has moved on, so the new head gets reviewed. */
export async function pruneStaleAutoPrReviews(
  live: ReadonlyArray<{ url: string; updatedAt?: string; headSha?: string }>,
): Promise<void> {
  const byUrl = new Map(live.map((r) => [r.url, r]));
  await updateAll((reviews) => {
    let dirty = false;
    for (const [url, entry] of Object.entries(reviews)) {
      const liveRow = byUrl.get(url);
      if (!liveRow) continue;
      if (!isSameReviewedHead(entry, liveRow)) {
        delete reviews[url];
        dirty = true;
      }
    }
    return dirty;
  });
}
