/**
 * Shared types for GitHub Search API (`/search/issues`) responses.
 *
 * The Search API returns "issue items" that represent PRs too; the `pull_request`
 * field is present when the row is a PR. We keep these intentionally loose
 * (every field optional) because we deserialize untrusted JSON.
 */
export interface SearchIssueItem {
  html_url?: string;
  title?: string;
  number?: number;
  state?: string;
  user?: { login?: string };
  repository_url?: string;
  created_at?: string;
  updated_at?: string;
  pull_request?: { merged_at?: string | null; url?: string };
}

export interface GhReviewRow {
  user?: { login?: string };
  submitted_at?: string;
  state?: string;
}

export interface SearchIssuesResponse {
  total_count?: number;
  items?: SearchIssueItem[];
}

/** Row returned by `gh pr list --json mergedAt,createdAt,title,url,number,author,state`. */
export interface GhPrRow {
  mergedAt?: string;
  createdAt?: string;
  title?: string;
  url?: string;
  number?: number;
  author?: { login?: string };
  state?: string;
}

/** The JSON field set we ask `gh pr list` for. Kept in one place so callers can't drift. */
export const GH_PR_JSON_FIELDS = "mergedAt,createdAt,title,url,number,author,state";

export type PrState = "merged" | "closed" | "open";

/** Derive a normalized PR state from the search-API or `gh pr list` shape. */
export function prStateFrom(row: { mergedAt?: string | null; state?: string }): PrState {
  if (row.mergedAt) return "merged";
  return row.state?.toLowerCase() === "closed" ? "closed" : "open";
}
