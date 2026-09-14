import { execGh } from "@/lib/gh-exec";
import { getRepoRoot } from "@/lib/notes/dir";
import { getGithubFullNameForLocalRepo, listRepos } from "@/lib/repos";
import { dedupeBy } from "@/lib/dedupe";
import { parseRepoFullNameFromApiUrl } from "@/lib/github/repo-url";
import { pMap } from "@/lib/p-limit";
import { SUBPROCESS_CONCURRENCY } from "@/lib/standup/config";
import {
  prStateFrom,
  type SearchIssueItem,
  type SearchIssuesResponse,
} from "@/lib/github/search-types";
import { applySkippedPrs } from "@/lib/github/skipped-prs";

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
  /** Normalized state when known (recently reviewed / closed search hits). */
  prState?: "open" | "closed" | "merged";
}

export interface RecentlyReviewedPr extends GithubPrRow {
  prState: "open" | "closed" | "merged";
  reviewedAt: string;
}

/** JSON body for `GET /api/github/prs` on success (client + server). */
export interface GithubPrsApiPayload {
  configured: boolean;
  authored: GithubPrRow[];
  reviews: GithubPrRow[];
  recentlyReviewed: RecentlyReviewedPr[];
  cached?: boolean;
  /** True when served from an expired cache after GitHub timed out (504). */
  stale?: boolean;
  warning?: string;
}

const MAX_REPOS = 100;
/**
 * Upper bound on rows kept per bucket. Was 30, which silently dropped PRs when a
 * team review request fanned a single PR out across dozens of repos — the row
 * existed in the search results but fell off the end of the slice.
 */
const MAX_LIST = 100;
const SEARCH_PER_PAGE = 100;

function authorFromSearchItem(item: SearchIssueItem): GithubPrAuthor | undefined {
  const login = item.user?.login?.trim();
  if (!login) return undefined;
  const avatarUrl = item.user?.avatar_url?.trim();
  return {
    login,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function rowFromSearchItem(item: SearchIssueItem): GithubPrRow {
  return {
    number: item.number ?? 0,
    title: item.title ?? "",
    url: item.html_url ?? "",
    repo: parseRepoFullNameFromApiUrl(item.repository_url),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    author: authorFromSearchItem(item),
  };
}

export async function isRepoArchived(fullName: string): Promise<boolean> {
  try {
    const { stdout } = await execGh(["repo", "view", fullName, "--json", "isArchived"]);
    const parsed = JSON.parse(stdout) as { isArchived?: boolean };
    return parsed.isArchived === true;
  } catch {
    return false;
  }
}

async function filterOutArchivedRepos(fullNames: string[]): Promise<string[]> {
  const results = await pMap(fullNames, SUBPROCESS_CONCURRENCY, async (name) => ({
    name,
    archived: await isRepoArchived(name),
  }));
  return results.filter((r) => !r.archived).map((r) => r.name);
}

/** Devhub + sibling clones with a `github.com` remote (same scan as the PR panel). */
export async function listGithubScanRepoFullNames(): Promise<string[]> {
  const names = new Set<string>();
  const rootFn = getGithubFullNameForLocalRepo(getRepoRoot());
  if (rootFn) names.add(rootFn);
  try {
    const locals = await listRepos();
    for (const r of locals) {
      const fn = getGithubFullNameForLocalRepo(r.path);
      if (fn) names.add(fn);
    }
  } catch {
    // ignore — still use devhub remote if present
  }
  const all = [...names].sort().slice(0, MAX_REPOS);
  return filterOutArchivedRepos(all);
}

const MAX_SEARCH_PAGES = 5;

export async function searchIssues(query: string, limit: number): Promise<SearchIssueItem[]> {
  const allItems: SearchIssueItem[] = [];
  let page = 1;

  while (allItems.length < limit && page <= MAX_SEARCH_PAGES) {
    const path = `/search/issues?per_page=${SEARCH_PER_PAGE}&page=${page}&q=${encodeURIComponent(query)}`;
    const { stdout } = await execGh(["api", path]);
    const data = JSON.parse(stdout) as SearchIssuesResponse;
    const items = data.items ?? [];
    allItems.push(...items);
    if (allItems.length >= (data.total_count ?? 0) || items.length < SEARCH_PER_PAGE) break;
    page++;
  }

  return allItems;
}

async function searchOpenPrs(query: string): Promise<SearchIssueItem[]> {
  return searchIssues(query, MAX_LIST);
}

interface ApprovalSearchNode {
  url?: string;
  reviewDecision?: string | null;
  latestOpinionatedReviews?: { nodes?: Array<{ state?: string } | null> | null } | null;
}

interface ApprovalSearchResponse {
  data?: {
    authored?: { nodes?: Array<ApprovalSearchNode | null> | null } | null;
    reviewing?: { nodes?: Array<ApprovalSearchNode | null> | null } | null;
  } | null;
}

const APPROVAL_SEARCH_QUERY = `
query($authored: String!, $reviewing: String!) {
  authored: search(query: $authored, type: ISSUE, first: 100) { nodes { ...approval } }
  reviewing: search(query: $reviewing, type: ISSUE, first: 100) { nodes { ...approval } }
}
fragment approval on PullRequest {
  url
  reviewDecision
  latestOpinionatedReviews(first: 50, writersOnly: true) { nodes { state } }
}
`;

/**
 * `reviewDecision` is null on repos that do not *require* reviews, so the old
 * `review:approved` search silently missed approved PRs (one with a write-access
 * APPROVED review on HEAD still never got the tick).
 * `latestOpinionatedReviews` is the per-reviewer latest verdict, so a later
 * "changes requested" still cancels an earlier approval.
 */
function isApprovedNode(node: ApprovalSearchNode): boolean {
  if (node.reviewDecision === "APPROVED") return true;
  const states = (node.latestOpinionatedReviews?.nodes ?? [])
    .map((r) => r?.state)
    .filter((state): state is string => Boolean(state));
  return states.includes("APPROVED") && !states.includes("CHANGES_REQUESTED");
}

/** Best-effort: a failed approval lookup must not take down the PR list. */
async function fetchApprovedPrUrls(): Promise<Set<string>> {
  try {
    const { stdout } = await execGh([
      "api",
      "graphql",
      "-f",
      `query=${APPROVAL_SEARCH_QUERY}`,
      "-f",
      "authored=author:@me is:pr state:open",
      "-f",
      "reviewing=review-requested:@me is:pr state:open",
    ]);
    const parsed = JSON.parse(stdout) as ApprovalSearchResponse;
    const nodes = [
      ...(parsed.data?.authored?.nodes ?? []),
      ...(parsed.data?.reviewing?.nodes ?? []),
    ];
    return new Set(
      nodes
        .filter((node): node is ApprovalSearchNode => node !== null && node !== undefined)
        .filter(isApprovedNode)
        .map((node) => node.url?.trim())
        .filter((url): url is string => Boolean(url)),
    );
  } catch {
    return new Set();
  }
}

/**
 * All open PRs you authored and PRs awaiting your review, using the GitHub Search API
 * across all repositories (not limited to locally cloned repos).
 */
export async function fetchMyGithubPrs(): Promise<{ authored: GithubPrRow[]; reviews: GithubPrRow[] }> {
  // One parallel GraphQL lookup for approval state is cheaper than N× `gh pr view`.
  const [authoredItems, reviewItems, approvedUrls] = await Promise.all([
    searchOpenPrs("author:@me is:pr state:open sort:updated-desc"),
    searchOpenPrs("review-requested:@me is:pr state:open sort:updated-desc"),
    fetchApprovedPrUrls(),
  ]);

  const withApproval = (item: SearchIssueItem): GithubPrRow => {
    const row = rowFromSearchItem(item);
    return approvedUrls.has(row.url) ? { ...row, approved: true } : row;
  };

  const authoredRaw = dedupeBy(authoredItems.map(withApproval), "url").slice(0, MAX_LIST);
  const reviewsRaw = await applySkippedPrs(
    dedupeBy(reviewItems.map(withApproval), "url").slice(0, MAX_LIST),
  );

  return { authored: authoredRaw, reviews: reviewsRaw };
}

const MAX_RECENTLY_REVIEWED = 10;
const RECENT_DAYS = 7;

export async function fetchRecentlyReviewedPrs(
  login: string,
  excludeUrls: Set<string>,
): Promise<RecentlyReviewedPr[]> {
  const since = new Date();
  since.setDate(since.getDate() - RECENT_DAYS);
  const sinceYmd = since.toISOString().slice(0, 10);

  const q = `reviewed-by:${login} is:pr -author:@me updated:>=${sinceYmd} sort:updated-desc`;
  const path = `/search/issues?per_page=50&q=${encodeURIComponent(q)}`;

  let items: SearchIssueItem[] = [];
  try {
    const { stdout } = await execGh(["api", path]);
    const data = JSON.parse(stdout) as SearchIssuesResponse;
    items = data.items ?? [];
  } catch {
    return [];
  }

  const out: RecentlyReviewedPr[] = [];
  for (const it of items) {
    const url = it.html_url ?? "";
    if (!url || excludeUrls.has(url)) continue;
    if (it.user?.login === login) continue;

    const mergedAt = it.pull_request?.merged_at;
    const prState = prStateFrom({ mergedAt: mergedAt ?? null, state: it.state });

    out.push({
      number: it.number ?? 0,
      title: it.title ?? "",
      url,
      repo: parseRepoFullNameFromApiUrl(it.repository_url),
      author: authorFromSearchItem(it),
      prState,
      reviewedAt: it.updated_at ?? "",
    });
  }

  out.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  return dedupeBy(out, "url").slice(0, MAX_RECENTLY_REVIEWED) as RecentlyReviewedPr[];
}

let listCache: { data: GithubPrsApiPayload; ts: number } | null = null;
const LIST_CACHE_TTL_MS = 2 * 60 * 1000;

export function readGithubPrsListCache(): GithubPrsApiPayload | null {
  if (!listCache || Date.now() - listCache.ts >= LIST_CACHE_TTL_MS) return null;
  return listCache.data;
}

/**
 * How far past the TTL a cached list may still be served when GitHub is down.
 *
 * Unbounded staleness is worse than an error: a three-day-old PR list looks
 * current, and "stale" in the banner reads as minutes, not days.
 */
export const STALE_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

/** Last good payload past TTL but within {@link STALE_CACHE_MAX_AGE_MS}. */
export function readStaleGithubPrsListCache(): GithubPrsApiPayload | null {
  if (!listCache || Date.now() - listCache.ts >= STALE_CACHE_MAX_AGE_MS) return null;
  return listCache.data;
}

export function writeGithubPrsListCache(data: GithubPrsApiPayload): void {
  listCache = { data, ts: Date.now() };
}

export function invalidateGithubPrsCache(): void {
  listCache = null;
}

/**
 * Drop one PR from the cached payload without discarding the rest.
 *
 * Skipping a PR used to invalidate the whole list, so the next poll re-ran two
 * `gh` searches — work through a review queue and GitHub's secondary rate limit
 * kicks in. The only thing that changed is that one row, so edit it out and
 * leave the cache's TTL alone.
 */
export function dropPrFromGithubPrsCache(url: string): void {
  if (!listCache) return;
  const { data } = listCache;
  listCache = {
    ...listCache,
    data: {
      ...data,
      authored: data.authored.filter((row) => row.url !== url),
      reviews: data.reviews.filter((row) => row.url !== url),
    },
  };
}
