/**
 * Pull issue-tracker and pull-request references out of a commit message.
 *
 * This is the join key between git history and the review notes in
 * `notes/pr-reviews`. Two shapes cover essentially everything in practice:
 *
 *   "PTF-4381 - Move read-next cache policy to CAPI (#554)"
 *    ^ ticket                                        ^ squash-merge PR number
 */

/** `(#554)` / `#554` at a word boundary — GitHub's squash-merge suffix. */
const PR_RE = /(?:^|\s|\()#(\d{1,6})\b/g;

/**
 * `PTF-4381`, `DP-6122`. Deliberately requires uppercase: lowercase matches
 * turn every hyphenated identifier in a subject line into a false ticket.
 */
const TICKET_RE = /\b([A-Z][A-Z0-9]{1,5}-\d{1,6})\b/g;

/**
 * Words that look like tickets but never are. `UTF-8` is the one that actually
 * shows up; the rest are cheap insurance.
 */
const TICKET_DENYLIST = new Set(["UTF-8", "UTF-16", "SHA-1", "SHA-256", "ISO-8601", "RFC-3339"]);

export interface CommitRefs {
  /** PR numbers referenced by the message, most-likely-first (last wins in git). */
  prNumbers: number[];
  /** Upper-cased tracker ids. */
  tickets: string[];
}

export function parseCommitRefs(message: string): CommitRefs {
  if (!message) return { prNumbers: [], tickets: [] };

  const prNumbers: number[] = [];
  for (const m of message.matchAll(PR_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && !prNumbers.includes(n)) prNumbers.push(n);
  }

  const tickets: string[] = [];
  for (const m of message.matchAll(TICKET_RE)) {
    const t = m[1]!;
    if (TICKET_DENYLIST.has(t)) continue;
    if (!tickets.includes(t)) tickets.push(t);
  }

  return { prNumbers, tickets };
}
