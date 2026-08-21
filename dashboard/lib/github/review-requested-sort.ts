import { prNotePath } from "@/lib/pr-note";

export interface ReviewRequestedSortRow {
  repo: string;
  number: number;
  createdAt?: string;
}

/** Canonical vault path for the agent-review note that belongs to this PR. */
export function reviewNotePathForPr(pr: ReviewRequestedSortRow): string {
  return `${prNotePath({ repo: pr.repo, number: pr.number })}.json`;
}

/**
 * Sort key for the "review requested" list: newer of PR createdAt and the
 * local agent-review note's created/updated time. Missing dates count as 0,
 * so a PR with neither createdAt nor a note sinks rather than NaN-scrambling
 * the order.
 */
export function reviewRequestedSortKeyMs(
  createdAt: string | undefined,
  noteActivityMs: number | undefined,
): number {
  const parsed = createdAt ? Date.parse(createdAt) : Number.NaN;
  const createdMs = Number.isFinite(parsed) ? parsed : 0;
  return Math.max(createdMs, noteActivityMs ?? 0);
}

/** Newest-first. Tie-break on repo, then PR number, so the order is stable. */
export function sortReviewRequestedPrs<T extends ReviewRequestedSortRow>(
  rows: readonly T[],
  noteActivityByPath: ReadonlyMap<string, number>,
): T[] {
  return [...rows].sort((a, b) => {
    const aKey = reviewRequestedSortKeyMs(a.createdAt, noteActivityByPath.get(reviewNotePathForPr(a)));
    const bKey = reviewRequestedSortKeyMs(b.createdAt, noteActivityByPath.get(reviewNotePathForPr(b)));
    return bKey - aKey || a.repo.localeCompare(b.repo) || a.number - b.number;
  });
}
