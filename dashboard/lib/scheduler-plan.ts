/**
 * Pure cron planning for the scheduler, kept apart so it is testable without
 * timers, disk or a running dashboard.
 *
 * The scheduler compares cron occurrences against the wall clock on a short
 * tick instead of arming one long `setTimeout`. Node's timers run on a
 * monotonic clock that stops while a Mac sleeps, so a long timer fires late
 * by however long the lid was shut — and the old "still due within 30s?"
 * guard then silently skipped the run.
 */
import { CronExpressionParser } from "cron-parser";

export function nextOccurrence(cron: string, after: number): number | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: new Date(after) }).next().getTime();
  } catch {
    return null;
  }
}

/**
 * The most recent occurrence in `(since, now]`, or null.
 *
 * Several missed occurrences (a Mac asleep all weekend) collapse into one run:
 * catching up means "run once, now", not "replay every hour you missed".
 */
export function dueOccurrence(cron: string, since: number, now: number): number | null {
  try {
    // cron-parser's prev() is strictly before currentDate; nudge past `now`
    // so an occurrence landing exactly on this tick still counts.
    const prev = CronExpressionParser.parse(cron, { currentDate: new Date(now + 1_000) })
      .prev()
      .getTime();
    return prev > since && prev <= now ? prev : null;
  } catch {
    return null;
  }
}

/** Earliest next occurrence across the given crons, or null when none parse. */
export function earliestOccurrence(crons: readonly string[], after: number): number | null {
  let earliest: number | null = null;
  for (const cron of crons) {
    const next = nextOccurrence(cron, after);
    if (next !== null && (earliest === null || next < earliest)) earliest = next;
  }
  return earliest;
}
