/**
 * Index of PR-review notes, keyed by the things a commit message can mention.
 *
 * This is what turns "who wrote this line" into "why is this line like this":
 * blame gives a commit, the commit names a PR or a ticket, and the review note
 * for that PR is the reasoning nobody bothered to put in the commit body.
 */

import { parseCommitRefs } from "@/lib/git/commit-refs";

export interface ReviewNoteRef {
  /** Vault-relative path, e.g. `pr-reviews/businessinsider-capi-525.json`. */
  path: string;
  title: string;
  /** Repo the note is about, from its PR link or filename. */
  repo: string | null;
  prNumbers: number[];
  tickets: string[];
}

export type MatchConfidence = "pr" | "ticket" | "related";

export interface ReviewNoteMatch extends ReviewNoteRef {
  confidence: MatchConfidence;
  /** What actually matched, for the tooltip: "#525" or "PTF-3774". */
  via: string;
}

const PR_URL_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
/** `businessinsider-capi-525.json` → org-repo prefix + trailing PR number. */
const FILENAME_RE = /^(.+)-(\d+)$/;

/** Flatten BlockNote content to a searchable string, including link hrefs. */
export function blocksToSearchText(blocks: unknown): string {
  const out: string[] = [];
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const b = raw as Record<string, unknown>;
      const content = b.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const inline = c as Record<string, unknown>;
          if (inline.type === "link") {
            if (typeof inline.href === "string") out.push(inline.href);
            walkInline(inline.content);
          } else if (typeof inline.text === "string") {
            out.push(inline.text);
          }
        }
      }
      const props = b.props as Record<string, unknown> | undefined;
      if (typeof props?.url === "string") out.push(props.url);
      walk(b.children);
    }
  };
  const walkInline = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      const inline = c as Record<string, unknown>;
      if (typeof inline.text === "string") out.push(inline.text);
    }
  };
  walk(blocks);
  return out.join(" ");
}

/**
 * Build a note ref from one review note.
 *
 * The PR link inside the note is authoritative for the repo; the filename is a
 * fallback because repo names contain hyphens and splitting them is guesswork.
 */
export function buildReviewNoteRef(
  path: string,
  blocks: unknown,
): ReviewNoteRef {
  const text = blocksToSearchText(blocks);
  const fileName = path.split("/").pop()?.replace(/\.json$/, "") ?? path;

  const prNumbers: number[] = [];
  let repo: string | null = null;
  for (const [, , repoName, num] of text.matchAll(PR_URL_RE)) {
    repo = repo ?? repoName ?? null;
    const n = Number(num);
    if (Number.isFinite(n) && !prNumbers.includes(n)) prNumbers.push(n);
  }

  const fromName = FILENAME_RE.exec(fileName);
  if (fromName) {
    const n = Number(fromName[2]);
    if (Number.isFinite(n) && !prNumbers.includes(n)) prNumbers.push(n);
    // Prefix is `<org>-<repo>`; without knowing the org split we keep the whole
    // thing and match repos by suffix below.
    repo = repo ?? fromName[1] ?? null;
  }

  const { tickets } = parseCommitRefs(text);

  return { path, title: fileName, repo, prNumbers, tickets };
}

/** Does this note belong to `repoName`? Suffix match handles `org-repo` prefixes. */
function noteIsForRepo(note: ReviewNoteRef, repoName: string): boolean {
  if (!note.repo) return false;
  const a = note.repo.toLowerCase();
  const b = repoName.toLowerCase();
  return a === b || a.endsWith(`-${b}`);
}

/**
 * Match review notes to one commit message.
 *
 * Confidence is the whole point of the return shape:
 * - `pr`      — the commit's squash number matches a note for *this* repo.
 * - `ticket`  — same repo, matched on tracker id.
 * - `related` — the ticket matches a note about a **different** repo. Worth
 *               showing (a ticket often spans services) but it is emphatically
 *               not "the review for this commit", and an earlier prototype of
 *               this silently presented one as the other.
 */
export function matchReviewNotes(
  notes: ReviewNoteRef[],
  repoName: string,
  commitMessage: string,
  limit = 4,
): ReviewNoteMatch[] {
  const { prNumbers, tickets } = parseCommitRefs(commitMessage);
  if (prNumbers.length === 0 && tickets.length === 0) return [];

  const seen = new Set<string>();
  const matches: ReviewNoteMatch[] = [];

  const add = (note: ReviewNoteRef, confidence: MatchConfidence, via: string) => {
    if (seen.has(note.path)) return;
    seen.add(note.path);
    matches.push({ ...note, confidence, via });
  };

  for (const note of notes) {
    const sameRepo = noteIsForRepo(note, repoName);
    if (!sameRepo) continue;
    const pr = prNumbers.find((n) => note.prNumbers.includes(n));
    if (pr !== undefined) add(note, "pr", `#${pr}`);
  }
  for (const note of notes) {
    const sameRepo = noteIsForRepo(note, repoName);
    const ticket = tickets.find((t) => note.tickets.includes(t));
    if (ticket === undefined) continue;
    add(note, sameRepo ? "ticket" : "related", ticket);
  }

  return matches.slice(0, limit);
}
