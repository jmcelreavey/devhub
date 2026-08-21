/**
 * Client-safe matching for the PR screen's search box.
 *
 * Deliberately no `node:` imports — this runs in the browser to filter the rows
 * already on screen, and on the server to build the remote-search query.
 */
import type { GithubPrRow } from "@/lib/github/prs";
import type { PrState } from "@/lib/github/search-types";

/** A PR found by the GitHub-wide search fallback (may be closed or merged). */
export interface PrSearchRow extends GithubPrRow {
  prState: PrState;
}

/** JSON body for `GET /api/github/prs/search`. */
export interface PrSearchApiPayload {
  configured: boolean;
  query: string;
  /** The GitHub search string actually issued — surfaced so the UI can explain the scope. */
  ghQuery: string;
  results: PrSearchRow[];
}

/** Split on whitespace so "meta syndication" narrows instead of failing. */
export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every searchable string on a PR row, lowercased. */
function haystack(row: GithubPrRow): string {
  const parts: string[] = [
    row.title ?? "",
    row.repo ?? "",
    `${row.repo}#${row.number}`,
    `#${row.number}`,
    String(row.number ?? ""),
    row.author?.login ?? "",
  ];
  return parts.join("   ").toLowerCase();
}

/** True when every term appears somewhere on the row (AND semantics). */
export function matchesPrSearch(row: GithubPrRow, query: string): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const hay = haystack(row);
  return terms.every((t) => hay.includes(t));
}

export function filterPrRows<T extends GithubPrRow>(rows: readonly T[], query: string): T[] {
  if (searchTerms(query).length === 0) return [...rows];
  return rows.filter((row) => matchesPrSearch(row, query));
}

/** GitHub search qualifiers the user may type themselves, e.g. `author:foo`. */
const QUALIFIER_RE = /(^|\s)[a-z-]+:\S+/i;

export function hasSearchQualifier(query: string): boolean {
  return QUALIFIER_RE.test(query);
}

/**
 * Build the `q` for `/search/issues`. A query that already carries qualifiers is
 * passed through untouched (beyond `is:pr`); a bare phrase gets scoped to the
 * orgs the user belongs to so we don't trawl all of GitHub.
 */
export function buildPrSearchQuery(query: string, orgs: readonly string[]): string {
  const trimmed = query.trim();
  const parts = ["is:pr", trimmed];
  if (!hasSearchQualifier(trimmed) && orgs.length > 0) {
    parts.push(...orgs.map((o) => `org:${o}`));
  }
  parts.push("sort:updated-desc");
  return parts.filter(Boolean).join(" ");
}
