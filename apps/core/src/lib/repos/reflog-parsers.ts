/**
 * Parsers for `git reflog`.
 *
 * The reflog is git's record of every position HEAD has held, including commits
 * that nothing points at any more — the ones a reset or a botched rebase left
 * unreachable. DevHub writes `devhub/backup-*` refs before its own destructive
 * operations, but anything that happens outside that path (a reset from the
 * integrated terminal, a rebase that went further than intended) has had no
 * recovery surface at all.
 */

/** Record separator the --format uses (%x1e), kept out of the source as a literal. */
const RECORD_SEP = String.fromCharCode(30);
const FIELD_SEP = String.fromCharCode(0);

export interface ReflogEntry {
  /** Selector as git names it, e.g. `HEAD@{3}`. */
  selector: string;
  hash: string;
  shortHash: string;
  /** The operation: `commit`, `reset`, `rebase (finish)`, `checkout`, … */
  action: string;
  /** What the operation was on — the part after the colon. */
  detail: string;
  relativeDate: string;
  /** True when nothing currently reachable points at this commit. */
  unreachable?: boolean;
}

/**
 * Parse `git reflog --format=%x1e%H%x00%h%x00%gd%x00%gs%x00%gr`.
 *
 * `%gs` is the whole subject — "reset: moving to HEAD~3" — which is split on
 * the first colon so the action can be shown apart from its target. Entries
 * without a colon (rare, but `%gs` is free-form) keep the whole string as the
 * action rather than being dropped.
 */
export function parseReflog(stdout: string): ReflogEntry[] {
  return stdout
    .split(RECORD_SEP)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [hash = "", shortHash = "", selector = "", subject = "", relativeDate = ""] = chunk
        .trim()
        .split(FIELD_SEP);
      const colon = subject.indexOf(":");
      const action = colon === -1 ? subject.trim() : subject.slice(0, colon).trim();
      const detail = colon === -1 ? "" : subject.slice(colon + 1).trim();
      return { selector, hash, shortHash, action, detail, relativeDate };
    })
    .filter((entry) => entry.hash);
}

/**
 * Mark entries whose commit is no longer reachable from any ref.
 *
 * This is the whole point of the browser: a reachable commit can be found in
 * the history view, while an unreachable one exists only here and only until
 * git prunes it. Callers pass the set of reachable hashes; anything outside it
 * is flagged.
 */
export function markUnreachable(entries: ReflogEntry[], reachable: Set<string>): ReflogEntry[] {
  return entries.map((entry) => ({ ...entry, unreachable: !reachable.has(entry.hash) }));
}

/**
 * Collapse consecutive entries pointing at the same commit.
 *
 * A checkout between branches that share a tip, or a sequence of no-op resets,
 * writes several entries for one position. Keeping the newest of each run means
 * the list reads as "places HEAD has been" rather than "times HEAD was written".
 */
export function dedupeConsecutive(entries: ReflogEntry[]): ReflogEntry[] {
  const out: ReflogEntry[] = [];
  for (const entry of entries) {
    if (out[out.length - 1]?.hash === entry.hash) continue;
    out.push(entry);
  }
  return out;
}
