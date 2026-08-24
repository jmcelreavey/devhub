/**
 * Grouping for the "while you were away" banner.
 *
 * The banner's own rule is that a notification you see every morning
 * regardless of content is one you stop reading. Listing the same failing
 * script once per run broke that from the other end: three lines of
 * `collect_local_skills - exit 1` is one problem wearing three hats, and it
 * pushed the page's actual content below the fold to say nothing extra.
 *
 * Pure and client-safe on purpose - `since-last-visit.ts` reads the run log
 * from disk, so the component cannot import from there.
 */

export interface AwayFailure {
  script: string;
  exitCode?: number;
  startedAt: number;
  runId: string;
}

export interface GroupedFailure {
  script: string;
  exitCode?: number;
  /** How many runs of this script failed the same way. */
  count: number;
  /** Most recent failure in the group - what the age should be measured from. */
  latestAt: number;
  /** The most recent run, so a click can go straight to it. */
  runId: string;
}

/** How old the newest failure must be before this stops being urgent. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * One row per distinct problem, newest first. A script that failed with two
 * different exit codes is two problems, not one - the exit code is the closest
 * thing to a cause that a run log carries.
 */
export function groupAwayFailures(failures: AwayFailure[]): GroupedFailure[] {
  const groups = new Map<string, GroupedFailure>();

  for (const failure of failures) {
    const key = `${failure.script} ${failure.exitCode ?? ""}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        script: failure.script,
        exitCode: failure.exitCode,
        count: 1,
        latestAt: failure.startedAt,
        runId: failure.runId,
      });
      continue;
    }
    existing.count += 1;
    if (failure.startedAt > existing.latestAt) {
      existing.latestAt = failure.startedAt;
      existing.runId = failure.runId;
    }
  }

  return [...groups.values()].sort((a, b) => b.latestAt - a.latestAt);
}

/**
 * Nothing in the last day means nothing is on fire right now. The banner still
 * shows - you should know - but at warning weight rather than danger red,
 * which is otherwise reserved for things worth interrupting you over.
 */
export function isStale(groups: GroupedFailure[], now: number): boolean {
  if (groups.length === 0) return true;
  const newest = Math.max(...groups.map((g) => g.latestAt));
  return now - newest > STALE_AFTER_MS;
}
