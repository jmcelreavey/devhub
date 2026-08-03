/**
 * One definition of "safe to hand to git" for commit refs and repo-relative paths.
 *
 * These used to be copy-pasted into `git/show/route.ts`, `git/blame/route.ts` and
 * `open-at-revision.ts`, and they had drifted: the blame route accepted `abc1234^`
 * (Blame previous depends on it) while `open-at-revision` did not, so "Open with →
 * Cursor" failed with "Invalid commit" the moment you drilled back one revision.
 */

/** Max ref length — a SHA plus a realistic pile of `~`/`^` suffixes. */
const MAX_REF_CHARS = 128;

/** Full or abbreviated SHA, optionally suffixed with `^` / `~N` walks. */
const SHA_REF = /^[0-9a-fA-F]{4,40}(?:[~^][0-9]*)*$/;

/** `HEAD`, `HEAD~1`, `HEAD^^`, etc. */
const HEAD_REF = /^HEAD(?:[~^][0-9]*)*$/;

/**
 * A commit-ish we're willing to pass to git as a positional argument.
 *
 * Deliberately narrow: SHAs and HEAD walks only, no branch/tag names. `..` is
 * rejected outright so a ref can never turn into a range (`a..b`), and
 * whitespace/NUL are rejected so it can't be split into extra argv entries.
 */
export function isSafeCommitRef(ref: string): boolean {
  if (!ref || ref.length > MAX_REF_CHARS) return false;
  if (ref.includes("..") || ref.includes("\0") || /\s/.test(ref)) return false;
  return SHA_REF.test(ref) || HEAD_REF.test(ref);
}

/**
 * A repo-relative path we're willing to interpolate into a git pathspec or join
 * onto a cache root. Rejects absolute paths, NUL, and any `..` segment so the
 * result can never escape the repo (or the cache directory) it's joined to.
 */
export function isSafeRepoRelPath(filePath: string): boolean {
  if (!filePath || filePath.includes("\0")) return false;
  if (filePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(filePath)) return false;
  return !filePath.split(/[\\/]/).includes("..");
}
