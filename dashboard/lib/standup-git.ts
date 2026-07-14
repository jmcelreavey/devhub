import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { localCalendarDateISO } from "@/lib/local-calendar-date";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { ttlCacheByKey } from "@/lib/ttl-cache";
import { GIT_FETCH_CACHE_TTL_MS, GIT_FETCH_TIMEOUT_MS } from "@/lib/standup-config";

const exec = promisify(execFile);

export { localCalendarDateISO };

export function localYesterdayISO(today: Date): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - 1);
  return localCalendarDateISO(start);
}

/** Next calendar day after `today` (local), as YYYY-MM-DD — use as exclusive end for “through end of today”. */
export function localTomorrowISO(today: Date): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() + 1);
  return localCalendarDateISO(start);
}

/** Start of local calendar day for `YYYY-MM-DD` (machine timezone), epoch ms. */
export function localDayStartMillis(ymd: string): number {
  const parts = ymd.split("-").map((x) => Number.parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return Number.NaN;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d).getTime();
}

/** Local epoch ms for `YYYY-MM-DD` + `HH:mm` (machine timezone). */
export function localDatetimeMillis(ymd: string, hm: string): number {
  const dateParts = ymd.split("-").map((x) => Number.parseInt(x, 10));
  const timeParts = hm.split(":").map((x) => Number.parseInt(x, 10));
  if (
    dateParts.length !== 3 ||
    timeParts.length !== 2 ||
    dateParts.some((n) => !Number.isFinite(n)) ||
    timeParts.some((n) => !Number.isFinite(n))
  )
    return Number.NaN;
  const [y, mo, d] = dateParts;
  const [h, mi] = timeParts;
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Format epoch ms as `YYYY-MM-DD HH:MM:SS` in local timezone for git --since/--until. */
export function millisToLocalGitDatetime(ms: number): string {
  const d = new Date(ms);
  const date = localCalendarDateISO(d);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${h}:${m}:00`;
}

/**
 * `git config user.email` for the given working directory. Returns null if the
 * repo has no email configured or the call fails.
 *
 * Used as the `--author` filter on `git log` so we match what's actually in the
 * commit history (the GitHub login is _not_ what git checks against; it
 * substring-matches on the commit's `Author` line).
 */
export async function getGitUserEmail(cwd: string): Promise<string | null> {
  try {
    await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    const { stdout } = await exec("git", ["config", "user.email"], { cwd });
    const email = stdout.trim();
    return email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

const _gitFetchOnce = ttlCacheByKey(async (cwd: string) => {
  try {
    await runGitRepoAsync(cwd, ["fetch", "--all"], { timeout: GIT_FETCH_TIMEOUT_MS });
  } catch {
    // not a blocker — proceed with whatever refs are already local
  }
  return null;
}, GIT_FETCH_CACHE_TTL_MS);

/**
 * `git fetch --all` with a timeout, debounced via a TTL cache so repeated
 * standup refreshes don't re-fetch the same repo more than once per minute.
 * Silently ignores failures.
 */
export async function gitFetch(cwd: string): Promise<void> {
  await _gitFetchOnce(cwd);
}

export interface GitLogWindowOptions {
  /** Filter to commits whose author name/email substring-matches this value. */
  authorMatch?: string;
  /**
   * When true, searches across all refs (`--all`). Useful for picking up
   * feature-branch commits that aren't on the current HEAD.
   *
   * Caveat: combined with `authorMatch`, this can include rebased / cherry-picked
   * commits authored on different days — `git log` filters by author date and
   * `--all` widens the ref set, not the time window.
   */
  allRefs?: boolean;
}

/**
 * Commits in `cwd` with author date in `[sinceDatetime, untilDatetime)` in local time.
 */
export async function gitLogLinesLocalMidnightWindow(
  cwd: string,
  sinceDatetime: string,
  untilDatetime: string,
  maxLines: number,
  opts: GitLogWindowOptions = {},
): Promise<{ lines: string[]; truncated: boolean }> {
  try {
    const args = [
      "-c",
      "log.showSignature=false",
      "log",
      ...(opts.allRefs === false ? [] : ["--all"]),
      `--since=${sinceDatetime}`,
      `--until=${untilDatetime}`,
      "--pretty=format:%s",
      "-n",
      String(maxLines + 1),
    ];
    if (opts.authorMatch) {
      args.push(`--author=${opts.authorMatch}`);
    }
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 2 * 1024 * 1024 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length > maxLines) {
      return { lines: lines.slice(0, maxLines), truncated: true };
    }
    return { lines, truncated: false };
  } catch {
    return { lines: [], truncated: false };
  }
}

async function currentBranchUnpushedArgs(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd });
    const upstream = stdout.trim();
    if (upstream) return [`${upstream}..HEAD`];
  } catch {
    // No upstream configured. Fall back to current HEAD versus all remotes.
  }
  return ["HEAD", "--not", "--remotes"];
}

/**
 * Count local commits on the current branch that are not on its upstream.
 * Returns 0 on failure — this is informational only, surfaced as an
 * "unpushed" badge.
 */
export async function gitUnpushedCount(cwd: string): Promise<number> {
  try {
    const rangeArgs = await currentBranchUnpushedArgs(cwd);
    const { stdout } = await exec(
      "git",
      ["log", ...rangeArgs, "--pretty=format:%H"],
      { cwd, maxBuffer: 1 * 1024 * 1024 },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.length;
  } catch {
    return 0;
  }
}
