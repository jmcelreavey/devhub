/**
 * Cursor deep links — client-safe (no node imports).
 *
 * `cursor://file<abs-path>` opens the file (or folder) in Cursor without any
 * server round-trip, mirroring vscode://file. Used to make file references in
 * briefs, labs, and evidence lists clickable.
 */

/** Deep link that opens an absolute path (file or folder) in Cursor. */
export function cursorFileUrl(absolutePath: string, line?: number): string {
  return `cursor://file${absolutePath}${line ? `:${line}` : ""}`;
}

/** Deep link for a repo-relative path, given the repo's absolute root. */
export function cursorRepoFileUrl(repoPath: string, relPath: string): string {
  return cursorFileUrl(`${repoPath.replace(/\/+$/, "")}/${relPath.replace(/^\/+/, "")}`);
}

const REL_PATH_RE = /^[\w.@~-]+(\/[\w.@~-]+)+$/;
const ROOT_FILE_RE = /^[A-Za-z0-9_.-]+\.(md|json|ts|tsx|js|jsx|mjs|cjs|ya?ml|toml|tf|tfvars|py|go|rs|sh|sql|hcl|lock|env|txt)$/i;

/**
 * True when a backticked token from markdown looks like a repo-relative file
 * path worth linking (a/b.ts, docker-compose.yml) rather than a command,
 * URL, or code expression.
 */
export function looksLikeRepoFile(token: string): boolean {
  if (token.length > 200 || /\s/.test(token)) return false;
  if (/:\/\/|@.*:/.test(token)) return false; // URLs / git remotes
  return REL_PATH_RE.test(token) || ROOT_FILE_RE.test(token);
}
