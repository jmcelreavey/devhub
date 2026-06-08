import { execGh } from "./gh-exec";
import { listGithubScanRepoFullNames } from "./github-prs";
import { dedupeBy } from "./dedupe";
import {
  parseRepoFullNameFromApiUrl,
  parseRepoFullNameFromPrUrl,
} from "./github-repo-url";
import {
  GH_PR_JSON_FIELDS,
  type GhReviewRow,
  type GhPrRow,
  type PrState,
  prStateFrom,
  type SearchIssueItem,
  type SearchIssuesResponse,
} from "./github-search-types";
import { ttlCache } from "./ttl-cache";
import { pMap } from "./p-limit";
import { REPO_LIST_TTL_MS, SUBPROCESS_CONCURRENCY } from "./standup-config";

export interface StandupMergedPr {
  title: string;
  url: string;
  repo: string;
  number: number;
  mergedAt: string;
  createdAt: string;
  state: PrState;
}

/** `gh api user` login — used for standup PR sections. */
export async function getGithubLogin(): Promise<string | null> {
  try {
    const { stdout } = await execGh(["api", "user", "-q", ".login"]);
    const login = stdout.trim();
    return login.length > 0 ? login : null;
  } catch {
    return null;
  }
}

/** Cached so repeated standup refreshes don't re-scan the disk + archived check. */
const getCachedRepoFullNames = ttlCache(
  () => listGithubScanRepoFullNames(),
  REPO_LIST_TTL_MS,
);

async function searchIssues(query: string, perPage = 50): Promise<SearchIssueItem[]> {
  const path = `/search/issues?per_page=${perPage}&q=${encodeURIComponent(query)}`;
  const { stdout } = await execGh(["api", path]);
  const data = JSON.parse(stdout) as SearchIssuesResponse;
  return data.items ?? [];
}

async function reviewSubmittedInRange(params: {
  repo: string;
  number: number;
  login: string;
  sinceMs: number;
  untilExclusiveMs: number;
}): Promise<string | null> {
  if (!params.repo || params.repo === "?" || params.number < 1) return null;
  try {
    const { stdout } = await execGh([
      "api",
      `/repos/${params.repo}/pulls/${params.number}/reviews?per_page=100`,
    ]);
    const reviews = JSON.parse(stdout) as GhReviewRow[];
    const submitted = reviews
      .filter((review) => review.user?.login === params.login && review.submitted_at)
      .map((review) => review.submitted_at ?? "")
      .filter((submittedAt) => inRange(Date.parse(submittedAt), params.sinceMs, params.untilExclusiveMs))
      .sort()
      .at(-1);
    return submitted ?? null;
  } catch {
    return null;
  }
}

/**
 * PRs you **reviewed** (GitHub `reviewed-by:`) updated in the time window.
 * Not limited to merged — includes open, closed, and merged PRs you reviewed.
 * Excludes PRs you **authored** so they only appear under the authored section.
 */
export async function fetchMergedPrsReviewedOthersInRange(params: {
  login: string;
  mergedSinceYmd: string;
  sinceMs: number;
  untilExclusiveMs: number;
  maxTotal: number;
  excludeAuthoredUrls: Set<string>;
}): Promise<StandupMergedPr[]> {
  let items: SearchIssueItem[] = [];
  try {
    items = await searchIssues(`is:pr reviewed-by:${params.login} updated:>=${params.mergedSinceYmd}`);
  } catch {
    return [];
  }

  const out: StandupMergedPr[] = [];
  for (const it of items) {
    const url = it.html_url ?? "";
    if (!url || params.excludeAuthoredUrls.has(url)) continue;
    if (it.user?.login === params.login) continue;

    const repo = parseRepoFullNameFromApiUrl(it.repository_url);
    const reviewedAt = await reviewSubmittedInRange({
      repo,
      number: it.number ?? 0,
      login: params.login,
      sinceMs: params.sinceMs,
      untilExclusiveMs: params.untilExclusiveMs,
    });
    if (!reviewedAt) continue;

    const mergedAt = it.pull_request?.merged_at;
    out.push({
      title: it.title ?? "",
      url,
      repo,
      number: it.number ?? 0,
      mergedAt: mergedAt ?? reviewedAt,
      createdAt: it.created_at ?? "",
      state: prStateFrom({ mergedAt: mergedAt ?? null, state: it.state }),
    });
  }

  out.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return dedupeBy(out, "url").slice(0, params.maxTotal);
}

async function fetchPrsMergedByMeInRange(params: {
  login: string;
  mergedSinceYmd: string;
  sinceMs: number;
  untilExclusiveMs: number;
  maxTotal: number;
}): Promise<StandupMergedPr[]> {
  let items: SearchIssueItem[] = [];
  try {
    items = await searchIssues(`is:pr author:${params.login} merged:>=${params.mergedSinceYmd}`);
  } catch {
    return [];
  }

  const out: StandupMergedPr[] = [];
  for (const it of items) {
    const url = it.html_url ?? "";
    const mergedAt = it.pull_request?.merged_at;
    if (!url || !mergedAt) continue;
    if (!inRange(Date.parse(mergedAt), params.sinceMs, params.untilExclusiveMs)) continue;

    out.push({
      title: it.title ?? "",
      url,
      repo: parseRepoFullNameFromApiUrl(it.repository_url),
      number: it.number ?? 0,
      mergedAt,
      createdAt: it.created_at ?? "",
      state: "merged",
    });
  }

  out.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return dedupeBy(out, "url").slice(0, params.maxTotal);
}

/**
 * PRs you authored that were created in the window, across GitHub-accessible
 * repos. This complements the local repo scan so standup doesn't miss PRs in
 * repos that are not cloned as siblings of devhub.
 */
async function fetchPrsCreatedByMeInRange(params: {
  login: string;
  createdSinceYmd: string;
  sinceMs: number;
  untilExclusiveMs: number;
  maxTotal: number;
}): Promise<StandupMergedPr[]> {
  const q = `is:pr author:${params.login} created:>=${params.createdSinceYmd}`;
  const path = `/search/issues?per_page=50&q=${encodeURIComponent(q)}`;

  let items: SearchIssueItem[] = [];
  try {
    const { stdout } = await execGh(["api", path]);
    const data = JSON.parse(stdout) as SearchIssuesResponse;
    items = data.items ?? [];
  } catch {
    return [];
  }

  const out: StandupMergedPr[] = [];
  for (const it of items) {
    const url = it.html_url ?? "";
    if (!url) continue;

    const createdAt = it.created_at ? Date.parse(it.created_at) : Number.NaN;
    if (!inRange(createdAt, params.sinceMs, params.untilExclusiveMs)) continue;

    const mergedAt = it.pull_request?.merged_at;
    out.push({
      title: it.title ?? "",
      url,
      repo: parseRepoFullNameFromApiUrl(it.repository_url),
      number: it.number ?? 0,
      mergedAt: mergedAt ?? "",
      createdAt: it.created_at ?? "",
      state: prStateFrom({ mergedAt: mergedAt ?? null, state: it.state }),
    });
  }

  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return dedupeBy(out, "url").slice(0, params.maxTotal);
}

/**
 * Scan every repo we have access to and collect PRs by `login`.
 *
 * One `gh pr list --state all` per repo, capped at `SUBPROCESS_CONCURRENCY`
 * concurrent spawns. Callers partition the rows in-memory into "merged in
 * window" / "created in window" subsets — running two separate scans would
 * double the subprocess count for no gain.
 */
async function scanReposForPrs(params: {
  login: string;
  maxPerRepo: number;
}): Promise<{ rows: GhPrRow[]; failedRepos: string[] }> {
  const repos = await getCachedRepoFullNames();
  if (repos.length === 0) return { rows: [], failedRepos: [] };

  const failedRepos: string[] = [];
  const perRepo = await pMap(repos, SUBPROCESS_CONCURRENCY, async (fullName) => {
    try {
      const { stdout } = await execGh([
        "pr",
        "list",
        "-R",
        fullName,
        "--state",
        "all",
        "--author",
        params.login,
        "--limit",
        String(params.maxPerRepo),
        "--json",
        GH_PR_JSON_FIELDS,
      ]);
      const parsed = JSON.parse(stdout) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed as GhPrRow[];
    } catch {
      // repo may be inaccessible or not on GitHub — record for surfacing to caller
      failedRepos.push(fullName);
      return [];
    }
  });

  return { rows: perRepo.flat(), failedRepos };
}

function rowToStandupPr(pr: GhPrRow): StandupMergedPr | null {
  const url = pr.url ?? "";
  if (!url) return null;
  return {
    title: pr.title ?? "",
    url,
    repo: parseRepoFullNameFromPrUrl(url),
    number: pr.number ?? 0,
    mergedAt: pr.mergedAt ?? "",
    createdAt: pr.createdAt ?? "",
    state: prStateFrom({ mergedAt: pr.mergedAt ?? null, state: pr.state }),
  };
}

function inRange(ms: number, sinceMs: number, untilExclusiveMs: number): boolean {
  return Number.isFinite(ms) && ms >= sinceMs && ms < untilExclusiveMs;
}

export interface AuthoredPrSlices {
  /** PRs you authored that **merged** inside the window. */
  mergedAuthored: StandupMergedPr[];
  /** PRs you authored that were **created** inside the window (any state). */
  prsCreated: StandupMergedPr[];
  /** Repos where `gh pr list` failed (surfaced for UI debugging). */
  prScanFailedRepos: string[];
}

/**
 * Single-pass collector for the two "authored" sections of the standup.
 * Halves the number of `gh pr list` subprocesses vs running each separately.
 */
export async function fetchAuthoredPrSlices(params: {
  login?: string | null;
  createdSinceYmd: string;
  sinceMs: number;
  untilExclusiveMs: number;
  maxPerRepo: number;
  maxMergedAuthored: number;
  maxPrsCreated: number;
}): Promise<AuthoredPrSlices> {
  const login = params.login ?? (await getGithubLogin());
  if (!login) return { mergedAuthored: [], prsCreated: [], prScanFailedRepos: [] };

  const [{ rows, failedRepos }, createdFromSearch, mergedFromSearch] = await Promise.all([
    scanReposForPrs({ login, maxPerRepo: params.maxPerRepo }),
    fetchPrsCreatedByMeInRange({
      login,
      createdSinceYmd: params.createdSinceYmd,
      sinceMs: params.sinceMs,
      untilExclusiveMs: params.untilExclusiveMs,
      maxTotal: params.maxPrsCreated,
    }),
    fetchPrsMergedByMeInRange({
      login,
      mergedSinceYmd: params.createdSinceYmd,
      sinceMs: params.sinceMs,
      untilExclusiveMs: params.untilExclusiveMs,
      maxTotal: params.maxMergedAuthored,
    }),
  ]);

  const merged: StandupMergedPr[] = [];
  const created: StandupMergedPr[] = [];

  for (const pr of rows) {
    const item = rowToStandupPr(pr);
    if (!item) continue;

    if (
      pr.mergedAt &&
      inRange(Date.parse(pr.mergedAt), params.sinceMs, params.untilExclusiveMs)
    ) {
      merged.push(item);
    }
    if (
      pr.createdAt &&
      inRange(Date.parse(pr.createdAt), params.sinceMs, params.untilExclusiveMs)
    ) {
      created.push(item);
    }
  }

  merged.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  // Sort created PRs by createdAt descending (mergedAt is empty for open PRs)
  created.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    mergedAuthored: dedupeBy([...mergedFromSearch, ...merged], "url").slice(0, params.maxMergedAuthored),
    prsCreated: dedupeBy([...createdFromSearch, ...created], "url").slice(0, params.maxPrsCreated),
    prScanFailedRepos: failedRepos,
  };
}
