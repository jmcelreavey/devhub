import type { GithubPrAuthor, GithubPrRow, GithubPrsApiPayload, RecentlyReviewedPr, PrChecksState } from "../../../../../packages/shared/github/pr-types";
export type { GithubPrAuthor, GithubPrRow, GithubPrsApiPayload, RecentlyReviewedPr } from "../../../../../packages/shared/github/pr-types";

import { execGh } from "../gh-exec";
import { emitCoreEvent } from "../../domains/events/core-events";
import type { PrFeedbackSnapshot } from "../../../../../packages/shared/github/pr-types";
import { getRepoRoot } from "../notes/dir";
import { getGithubFullNameForLocalRepo, listRepos } from "../repos/index";
import { dedupeBy } from "../dedupe";
import { parseRepoFullNameFromApiUrl } from "../../../../../packages/shared/ui-lib/github/repo-url";
import { pMap } from "../p-limit";
import { SUBPROCESS_CONCURRENCY } from "../standup/config";
import {
  prStateFrom,
  type SearchIssueItem,
  type SearchIssuesResponse,
} from "../../../../../packages/shared/ui-lib/github/search-types";
import { applySkippedPrs } from "./skipped-prs";
import {
  summarizeCheckCountBuckets,
} from "./branch-pr";

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

const canonicalFullNames = new Map<string, string>();

/**
 * A renamed repo keeps its old name in local remotes. REST follows the rename
 * redirect but the Search API does not — `repo:old/name` is a 422 — so resolve
 * the current name before building search qualifiers. Failures fall back to the
 * input uncached, so a transient GitHub error doesn't pin the stale name.
 */
export async function resolveCanonicalRepoFullName(fullName: string): Promise<string> {
  const cached = canonicalFullNames.get(fullName);
  if (cached) return cached;
  try {
    const { stdout } = await execGh(["api", `repos/${fullName}`, "--jq", ".full_name"]);
    const canonical = stdout.trim() || fullName;
    canonicalFullNames.set(fullName, canonical);
    return canonical;
  } catch {
    return fullName;
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

interface PrListMetaNode {
  url?: string;
  headRefName?: string;
  headRepository?: { nameWithOwner?: string } | null;
  state?: string;
  reviews?: { nodes?: Array<{ author?: { login?: string; __typename?: string }; submittedAt?: string; body?: string; state?: string }> };
  comments?: { nodes?: Array<{ author?: { login?: string; __typename?: string }; createdAt?: string; body?: string }> };
  reviewThreads?: { nodes?: Array<{ comments?: PrListMetaNode["comments"] }> };
  isDraft?: boolean | null;
  headRefOid?: string | null;
  reviewDecision?: string | null;
  latestOpinionatedReviews?: { nodes?: Array<{ state?: string } | null> | null } | null;
  commits?: {
    nodes?: Array<{
      commit?: {
        statusCheckRollup?: {
          state?: string | null;
          contexts?: {
            nodes?: Array<{ name?: string; context?: string; conclusion?: string; state?: string; completedAt?: string; createdAt?: string }>;
            checkRunCountsByState?: Array<{ state?: string; count?: number } | null> | null;
            statusContextCountsByState?: Array<{ state?: string; count?: number } | null> | null;
          } | null;
        } | null;
      } | null;
    } | null> | null;
  } | null;
}

interface PrListMetaResponse {
  data?: {
    viewer?: { login?: string };
    feedback?: { nodes?: Array<PrListMetaNode | null> };
    authored?: { nodes?: Array<PrListMetaNode | null> | null } | null;
    reviewing?: { nodes?: Array<PrListMetaNode | null> | null } | null;
  } | null;
}

export interface PrListMeta {
  feedback?: PrFeedbackSnapshot;
  draft: boolean;
  headSha?: string;
  approved: boolean;
  reviewDecision?: GithubPrRow["reviewDecision"];
  checks: PrChecksState;
  checkCounts: { passed: number; failed: number; pending: number };
}

// The existing bulk cache holds only the latest 100 PRs, 20 reviews/comments/threads
// and 50 check contexts. Missing timestamps never imply post-completion activity;
// older or uncached feedback appears only after GitHub includes it in this window.
const PR_LIST_META_QUERY = `
query($authored: String!, $reviewing: String!) {
  viewer { login }
  feedback: search(query: "author:@me is:pr sort:updated-desc", type: ISSUE, first: 100) { nodes { ...prListMeta } }
  authored: search(query: $authored, type: ISSUE, first: 100) { nodes { ...prListMeta } }
  reviewing: search(query: $reviewing, type: ISSUE, first: 100) { nodes { ...prListMeta } }
}
fragment prListMeta on PullRequest {
  url
  headRefName
  headRepository { nameWithOwner }
  state
  reviews(last: 20) { nodes { author { login __typename } submittedAt body state } }
  comments(last: 20) { nodes { author { login __typename } createdAt body } }
  reviewThreads(last: 20) { nodes { comments(last: 5) { nodes { author { login __typename } createdAt body } } } }
  isDraft
  headRefOid
  reviewDecision
  latestOpinionatedReviews(first: 50, writersOnly: true) { nodes { state } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 50) {
            nodes {
              ... on CheckRun { name conclusion completedAt }
              ... on StatusContext { context state createdAt }
            }
            checkRunCountsByState { state count }
            statusContextCountsByState { state count }
          }
        }
      }
    }
  }
}
`;

/**
 * `reviewDecision` is null on repos that do not *require* reviews, so the old
 * `review:approved` search silently missed approved PRs (one with a write-access
 * APPROVED review on HEAD still never got the tick).
 * `latestOpinionatedReviews` is the per-reviewer latest verdict, so a later
 * "changes requested" still cancels an earlier approval.
 */
export function isApprovedMetaNode(node: {
  reviewDecision?: string | null;
  latestOpinionatedReviews?: { nodes?: Array<{ state?: string } | null> | null } | null;
}): boolean {
  if (node.reviewDecision === "APPROVED") return true;
  const states = (node.latestOpinionatedReviews?.nodes ?? [])
    .map((r) => r?.state)
    .filter((state): state is string => Boolean(state));
  return states.includes("APPROVED") && !states.includes("CHANGES_REQUESTED");
}

/** Map GraphQL head-commit rollup counts onto the shared checks glance shape. */
export function checksFromMetaNode(node: PrListMetaNode): {
  checks: PrChecksState;
  checkCounts: { passed: number; failed: number; pending: number };
} {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const contexts = rollup?.contexts;
  return summarizeCheckCountBuckets({
    rollupState: rollup?.state,
    checkRunCountsByState: (contexts?.checkRunCountsByState ?? []).filter(
      (row): row is { state?: string; count?: number } => row != null,
    ),
    statusContextCountsByState: (contexts?.statusContextCountsByState ?? []).filter(
      (row): row is { state?: string; count?: number } => row != null,
    ),
  });
}

/**
 * Best-effort approval + CI glance for both open queues in one GraphQL search.
 * A failed lookup must not take down the PR list.
 */
export interface PrListMetaLookup extends Map<string, PrListMeta> { warning?: string }

export async function fetchPrListMetaByUrl(rows?: readonly GithubPrRow[]): Promise<PrListMetaLookup> {
  const out: PrListMetaLookup = new Map();
  try {
    let stdout: string;
    if (rows) {
      const urls = [...new Set(rows.map(row => row.url))];
      const batches = Array.from({ length: Math.ceil(urls.length / 25) }, (_, index) => urls.slice(index * 25, index * 25 + 25));
      const fragment = PR_LIST_META_QUERY.slice(PR_LIST_META_QUERY.indexOf("fragment prListMeta"));
      const responses = await pMap(batches, 2, async (batch) => {
        const query = `query { viewer { login } ${batch.map((url, index) => `pr${index}: resource(url: ${JSON.stringify(url)}) { ...prListMeta }`).join("\n")} }\n${fragment}`;
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await execGh(["api", "graphql", "-f", `query=${query}`]);
            const parsed = JSON.parse(response.stdout) as { data?: Record<string, unknown>; errors?: unknown[] };
            if (!parsed.data) throw new Error("GitHub returned no PR details.");
            if (parsed.errors?.length) out.warning = "Some PR details are unavailable. Retry to refresh them.";
            return parsed.data;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const transient = /\\b(429|5\\d\\d)\\b|timed? out|timeout|ECONNRESET|ETIMEDOUT|temporar|rate limit/i.test(message);
            if (attempt === 0 && transient) continue;
            out.warning = "Some PR details are unavailable. Retry to refresh them.";
            return {};
          }
        }
      });
      stdout = JSON.stringify({ data: { viewer: responses[0]?.viewer, authored: { nodes: responses.flatMap(data => Object.entries(data).filter(([key]) => key !== "viewer").map(([, value]) => value)) } } });
    } else {
      ({ stdout } = await execGh([
      "api",
      "graphql",
      "-f",
      `query=${PR_LIST_META_QUERY}`,
      "-f",
      "authored=author:@me is:pr state:open",
      "-f",
      "reviewing=review-requested:@me is:pr state:open",
    ]));
    }
    const parsed = JSON.parse(stdout) as PrListMetaResponse;
    const nodes = [
      ...(parsed.data?.feedback?.nodes ?? []),
      ...(parsed.data?.authored?.nodes ?? []),
      ...(parsed.data?.reviewing?.nodes ?? []),
    ];
    for (const node of nodes) {
      if (!node?.url?.trim()) continue;
      const url = node.url.trim();
      const { checks, checkCounts } = checksFromMetaNode(node);
      const reviewDecision: PrListMeta["reviewDecision"] = node.reviewDecision === "APPROVED" || node.reviewDecision === "CHANGES_REQUESTED" || node.reviewDecision === "REVIEW_REQUIRED"
        ? node.reviewDecision : (node.latestOpinionatedReviews?.nodes ?? []).some((review) => review?.state === "CHANGES_REQUESTED") ? "CHANGES_REQUESTED" : undefined;
      out.set(url, {
        feedback: {
          url, state: node.state ?? "OPEN", self: parsed.data?.viewer?.login ?? "", headBranch: node.headRefName, repo: node.headRepository?.nameWithOwner,
          activity: [
            ...(node.reviews?.nodes ?? []).map((review) => ({ author: review.author?.login ?? "", bot: review.author?.__typename === "Bot", at: review.submittedAt ?? "", body: review.body ?? "", state: review.state })),
            ...[...(node.comments?.nodes ?? []), ...(node.reviewThreads?.nodes ?? []).flatMap((thread) => thread.comments?.nodes ?? [])].map((comment) => ({ author: comment.author?.login ?? "", bot: comment.author?.__typename === "Bot", at: comment.createdAt ?? "", body: comment.body ?? "" })),
          ],
          failedChecks: (node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []).filter((check) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(check.conclusion ?? check.state ?? "")).map((check) => ({ name: check.name ?? check.context ?? "check", at: check.completedAt ?? check.createdAt ?? "" })),
        },
        draft: node.isDraft === true,
        ...(node.headRefOid ? { headSha: node.headRefOid } : {}),
        approved: isApprovedMetaNode(node),
        ...(reviewDecision ? { reviewDecision } : {}),
        checks,
        checkCounts,
      });
    }
  } catch (error) {
    if (rows) throw error;
    // Legacy background callers can still use the list without enrichment.
  }
  return out;
}

/** Keep feedback on recently closed PRs available to task follow-ups. */
export async function fetchPrFeedbackMeta(): Promise<PrListMetaLookup> {
  const items = await searchOpenPrs("author:@me is:pr sort:updated-desc");
  return fetchPrListMetaByUrl(items.map(rowFromSearchItem));
}

/**
 * All open PRs you authored and PRs awaiting your review, using the GitHub Search API
 * across all repositories (not limited to locally cloned repos).
 */
export async function fetchMyGithubPrs({ includeDetails = true }: { includeDetails?: boolean } = {}): Promise<{ authored: GithubPrRow[]; reviews: GithubPrRow[]; feedbackPrs?: PrFeedbackSnapshot[] }> {
  // One parallel GraphQL lookup for approval + CI counts is cheaper than N× `gh pr view`.
  const [authoredItems, reviewItems, metaByUrl] = await Promise.all([
    searchOpenPrs("author:@me is:pr state:open sort:updated-desc"),
    searchOpenPrs("review-requested:@me is:pr state:open sort:updated-desc"),
    includeDetails ? fetchPrListMetaByUrl() : Promise.resolve(new Map<string, PrListMeta>()),
  ]);

  const withMeta = (item: SearchIssueItem): GithubPrRow => {
    const row = rowFromSearchItem(item);
    const meta = metaByUrl.get(row.url);
    if (!meta) return row;
    return {
      ...row,
      ...(meta.approved ? { approved: true } : {}),
      ...(meta.reviewDecision ? { reviewDecision: meta.reviewDecision } : {}),
      draft: meta.draft,
      ...(meta.headSha ? { headSha: meta.headSha } : {}),
      checks: meta.checks,
      checkCounts: meta.checkCounts,
    };
  };

  // Sequential, not Promise.all: each call may prune and rewrite the same file.
  const authoredRaw = await applySkippedPrs(
    dedupeBy(authoredItems.map(withMeta), "url").slice(0, MAX_LIST),
  );
  const reviewsRaw = await applySkippedPrs(
    dedupeBy(reviewItems.map(withMeta), "url").slice(0, MAX_LIST),
  );

  return { authored: authoredRaw, reviews: reviewsRaw, feedbackPrs: [...metaByUrl.values()].flatMap((meta) => meta.feedback ? [meta.feedback] : []) };
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
let listCacheExpiry: ReturnType<typeof setTimeout> | undefined;
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
  clearTimeout(listCacheExpiry);
  listCacheExpiry = setTimeout(() => emitCoreEvent("board"), LIST_CACHE_TTL_MS);
  listCacheExpiry.unref();
  emitCoreEvent("board");
}

export function invalidateGithubPrsCache(): void {
  clearTimeout(listCacheExpiry);
  listCacheExpiry = undefined;
  if (!listCache) return;
  listCache = null;
  emitCoreEvent("board");
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
  emitCoreEvent("board");
}
