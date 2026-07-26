/**
 * Shared constants for the standup pipeline.
 *
 * Centralized here so the route handler stays focused on orchestration and the
 * thresholds can be tuned in one place. All values are local-only — no env
 * overrides needed.
 */

/** Max git log subjects per repo before we truncate. */
export const MAX_GIT = 40;

/** Max Jira tickets to render before truncation marker. */
export const MAX_JIRA_SHOW = 30;

/** Max PRs we ask `gh pr list` for per repo (covers both authored + merged). */
export const MERGED_PER_REPO = 60;

/** Caps on each PR section of the standup output. */
export const MAX_MERGED_AUTHORED = 25;
export const MAX_MERGED_REVIEWED = 25;
export const MAX_PRS_CREATED = 25;

/** `git fetch --all` timeout per repo. Failures are silently ignored. */
export const GIT_FETCH_TIMEOUT_MS = 5_000;

/**
 * Skip refetching the same repo more often than this. Standup endpoints are
 * often hit a few times in a row (refresh button, multiple tabs); a tiny TTL
 * here avoids hammering the network.
 */
export const GIT_FETCH_CACHE_TTL_MS = 60_000;

/** TTL on the list of GitHub repo full-names we scan for PRs. */
export const REPO_LIST_TTL_MS = 5 * 60_000;

/**
 * Cap on concurrent subprocess spawns when fanning out to every repo.
 * Each repo costs ~1 `git fetch` + 1 `gh pr list` per standup, so for 100
 * repos we'd otherwise spawn 200 children. 8 is a good balance for laptop CPUs.
 */
export const SUBPROCESS_CONCURRENCY = 8;
