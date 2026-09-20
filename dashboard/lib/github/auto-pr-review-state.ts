/**
 * Tracks auto agent-review starts so the poller / endpoint does not re-enqueue
 * the same PR after the first successful start — including after later pushes.
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
  /** Head commit at start time (informational; not a re-review trigger). */
  headSha?: string;
  repo: string;
  number: number;
  title: string;
  startedAt: string;
  /** Agent run id when started on a CLI provider. */
  runId?: string;
  /** OpenCode session id when started on OpenCode. */
  sessionId?: string;
  notePath?: string;
  /** Starts for this PR URL, counting retries after failed runs. */
  attempts?: number;
}

/**
 * True when DevHub has already started an auto-review for this PR URL.
 * Pushes / updatedAt changes do not clear this — review once per PR.
 * (Failed runs are retried separately via shouldRetryAutoReview.)
 */
export function wasAlreadyAutoReviewed(
  prior: Pick<AutoPrReviewRecord, "updatedAt" | "headSha"> | undefined | null,
): boolean {
  return Boolean(prior);
}

/**
 * @deprecated Prefer wasAlreadyAutoReviewed — kept for older call sites/tests.
 * Formerly keyed on head SHA so a new push re-queued; policy is now once per PR.
 */
export function isSameReviewedHead(
  prior: Pick<AutoPrReviewRecord, "updatedAt" | "headSha">,
  // live head ignored — once-per-PR policy
  ..._ignored: unknown[]
): boolean {
  void _ignored;
  return wasAlreadyAutoReviewed(prior);
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
  row: Pick<
    AutoPrReviewRecord,
    "url" | "updatedAt" | "headSha" | "repo" | "number" | "title" | "runId" | "sessionId" | "notePath"
  >,
): Promise<void> {
  await updateAll((reviews) => {
    const prev = reviews[row.url];
    const attempts = prev ? (prev.attempts ?? 1) + 1 : 1;
    reviews[row.url] = {
      url: row.url,
      updatedAt: row.updatedAt ?? "",
      repo: row.repo,
      number: row.number,
      title: row.title,
      startedAt: new Date().toISOString(),
      ...(row.headSha ? { headSha: row.headSha } : {}),
      ...(row.runId ? { runId: row.runId } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.notePath ? { notePath: row.notePath } : {}),
      attempts,
    };
    return true;
  });
}

/**
 * Drop entries whose PR left the review-requested queue (merged/closed/unsubscribed).
 * Does NOT clear on a new head SHA — once reviewed, stay reviewed.
 */
export async function pruneStaleAutoPrReviews(
  live: ReadonlyArray<{ url: string; updatedAt?: string; headSha?: string }>,
): Promise<void> {
  const liveUrls = new Set(live.map((r) => r.url));
  await updateAll((reviews) => {
    let dirty = false;
    for (const url of Object.keys(reviews)) {
      if (!liveUrls.has(url)) {
        delete reviews[url];
        dirty = true;
      }
    }
    return dirty;
  });
}
