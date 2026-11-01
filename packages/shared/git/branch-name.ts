/**
 * Local branch names we're willing to hand to git as a positional argument.
 *
 * Deliberately narrower than git's own rules: no whitespace or NUL (so a name
 * can't split into extra argv entries), no leading `-` (so it can't become a
 * flag), and no `..` (so it can't turn into a range).
 */
export function isSafeBranchName(branch: unknown): branch is string {
  if (typeof branch !== "string" || !branch || branch.length > 200) return false;
  if (branch.includes("..") || branch.includes("\0") || /\s/.test(branch)) return false;
  if (branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/")) return false;
  if (branch.endsWith(".lock") || branch.endsWith(".")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(branch);
}
