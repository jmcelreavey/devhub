export type PrChecksState = "passing" | "failing" | "pending" | "none";

export interface PrFeedbackActivity {
  author: string;
  at: string;
  body: string;
  state?: string;
  bot?: boolean;
}

export interface PrFeedbackSnapshot {
  headBranch?: string;
  repo?: string;
  url: string;
  state: string;
  self: string;
  activity: PrFeedbackActivity[];
  failedChecks: Array<{ name: string; at: string }>;
}

export interface GithubPrAuthor {
  login: string;
  avatarUrl?: string;
}

export interface GithubPrRow {
  number: number;
  title: string;
  url: string;
  repo: string;
  /** ISO timestamp from Search API `created_at` when available. */
  createdAt?: string;
  /** ISO timestamp from Search API `updated_at` when available. */
  updatedAt?: string;
  /** PR author from the Search API `user` field. */
  author?: GithubPrAuthor;
  /**
   * True when the PR carries a standing approval from a write-access reviewer.
   * Filled for open authored / review-requested rows via a parallel search.
   */
  approved?: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
  /**
   * Head-commit CI rollup for open authored / review-requested rows.
   * Filled from the same GraphQL search as approvals (count buckets — cheap).
   */
  checks?: PrChecksState;
  /** Counts behind {@link checks}, for tooltips. */
  checkCounts?: { passed: number; failed: number; pending: number };
  /** Normalized state when known (recently reviewed / closed search hits). */
  prState?: "open" | "closed" | "merged";
  /** Open-queue rows only (same GraphQL search as {@link checks}). */
  draft?: boolean;
  /** Head commit SHA — what auto-review dedupes on (comments bump updatedAt, not this). */
  headSha?: string;
}

export interface RecentlyReviewedPr extends GithubPrRow {
  prState: "open" | "closed" | "merged";
  reviewedAt: string;
}

/** JSON body for `GET /api/github/prs` on success (client + server). */
export interface GithubPrsApiPayload {
  feedbackPrs?: PrFeedbackSnapshot[];
  generatedAt?: string;
  configured: boolean;
  authored: GithubPrRow[];
  reviews: GithubPrRow[];
  recentlyReviewed: RecentlyReviewedPr[];
  cached?: boolean;
  /** True when served from an expired cache after GitHub timed out (504). */
  stale?: boolean;
  warning?: string;
  detailsState?: "pending" | "ready" | "partial";
  detailsWarning?: string;
}

