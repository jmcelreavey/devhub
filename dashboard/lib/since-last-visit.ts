/**
 * "What changed while I was away" (F-A).
 *
 * DevHub does work when you're not looking — scheduled scripts, syncs, agent
 * handoffs — and until now the only trace was a toast that had long since
 * disappeared. Come back on Monday and there was no way to ask what happened
 * over the weekend.
 *
 * This assembles that answer from sources that already exist, which is why it's
 * cheap: the run audit log (R1) and repo health (R5). No new collection, no new
 * storage, no background process.
 *
 * The "last visit" timestamp is owned by the client (localStorage) rather than
 * the server on purpose — it's a per-browser UI preference, not shared state,
 * and putting it on the server would mean two tabs fighting over it.
 */
import { listRecentRuns, type RunHistoryRow } from "@/lib/run-history";

export interface AwayDigest {
  /** The window this digest covers. */
  since: number;
  /** Runs that finished in the window and failed. */
  failedRuns: { script: string; exitCode?: number; startedAt: number; runId: string }[];
  /** Runs that finished in the window and succeeded. */
  succeededCount: number;
  /** True when nothing at all happened — lets the UI say so rather than render an empty shell. */
  quiet: boolean;
}

/** Ignore absurd windows: a corrupt timestamp shouldn't scan all history. */
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function buildAwayDigest(since: number, now = Date.now()): AwayDigest {
  const floor = Math.max(since, now - MAX_WINDOW_MS);

  // 200 is well above what a weekend produces, and the reader is capped anyway.
  const runs = listRecentRuns(200).filter((r) => runFinishedAfter(r, floor));

  const failedRuns = runs
    .filter((r) => !r.ok)
    .map((r) => ({
      script: r.script,
      exitCode: r.exitCode,
      startedAt: r.startedAt,
      runId: r.runId,
    }));

  const succeededCount = runs.length - failedRuns.length;

  return {
    since: floor,
    failedRuns,
    succeededCount,
    quiet: runs.length === 0,
  };
}

/**
 * A run counts as "while you were away" by when it *finished*, not when it
 * started. A backup that starts Friday evening and fails Saturday morning is
 * weekend news, and keying off startedAt would file it under Friday and hide it.
 */
function runFinishedAfter(run: RunHistoryRow, floor: number): boolean {
  return (run.finishedAt ?? run.startedAt) >= floor;
}
