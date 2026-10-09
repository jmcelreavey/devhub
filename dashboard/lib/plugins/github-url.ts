/**
 * The one place a pasted repository link is judged. No Node imports, so the
 * Add form and the server apply exactly the same rules and copy.
 *
 * Accepted: https://github.com/{owner}/{repo} with an optional ".git" suffix and
 * trailing slash. Everything else is refused with a sentence the form can show.
 */

export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
  /** https://github.com/owner/repo with no .git suffix. */
  url: string;
  cloneUrl: string;
}

export type UrlParseResult =
  | { ok: true; repo: ParsedGitHubRepo }
  | { ok: false; message: string };

export const URL_MESSAGES = {
  empty: "Paste a GitHub repository URL.",
  hostOrScheme: "Use an HTTPS link to a repository on github.com.",
  shape: "Use a repository link such as https://github.com/team/plugin.",
  credentials: "Remove the username or token from this URL.",
  pagePath: "Paste the repository’s main URL, without /tree, /blob or other page paths.",
  queryOrFragment: "Remove the query string or fragment from this URL.",
  refUnsupported: "Choosing a branch, tag or commit isn’t supported in this version.",
} as const;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function fail(message: string): UrlParseResult {
  return { ok: false, message };
}

export function parseGitHubRepoUrl(raw: string): UrlParseResult {
  const input = raw.trim();
  if (!input) return fail(URL_MESSAGES.empty);
  // Control characters, NULs and embedded whitespace never belong in a link.
  if (/[\u0000- \u007f]/.test(input)) return fail(URL_MESSAGES.hostOrScheme);
  // scp-style "git@github.com:owner/repo" has no scheme at all.
  if (!SCHEME_RE.test(input)) return fail(URL_MESSAGES.hostOrScheme);

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail(URL_MESSAGES.hostOrScheme);
  }

  const afterScheme = input.replace(SCHEME_RE, "");
  const authorityEnd = afterScheme.search(/[/?#]/);
  const authority = authorityEnd < 0 ? afterScheme : afterScheme.slice(0, authorityEnd);

  // Scheme and host come first so "ssh://git@github.com/..." is told to use
  // HTTPS rather than to remove a username that SSH requires.
  if (url.protocol !== "https:" || url.hostname !== "github.com") return fail(URL_MESSAGES.hostOrScheme);
  if (authority.includes("@") || url.username || url.password) return fail(URL_MESSAGES.credentials);
  if (!/^github\.com$/i.test(authority)) return fail(URL_MESSAGES.hostOrScheme);
  // An explicit port, including the default one, is never part of a repository link.
  if (authority.includes(":") || url.port) return fail(URL_MESSAGES.hostOrScheme);
  if (url.search || url.hash || /[?#]/.test(afterScheme)) return fail(URL_MESSAGES.queryOrFragment);

  // Judge the path as typed: URL parsing would quietly resolve "/a/../b/c".
  const rawPath = authorityEnd < 0 ? "" : afterScheme.slice(authorityEnd);
  if (rawPath.includes("%") || rawPath.includes("\\")) return fail(URL_MESSAGES.shape);
  const trimmed = rawPath.replace(/^\/+$/, "").replace(/\/$/, "");
  const segments = trimmed ? trimmed.slice(1).split("/") : [];
  if (segments.some((part) => part === "" || part === "." || part === "..")) return fail(URL_MESSAGES.shape);
  if (segments.length < 2) return fail(URL_MESSAGES.shape);
  if (segments.length > 2) return fail(URL_MESSAGES.pagePath);

  const owner = segments[0];
  let repo = segments[1];
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);
  if (!OWNER_RE.test(owner) || owner.includes("--")) return fail(URL_MESSAGES.shape);
  if (!REPO_RE.test(repo) || repo === "." || repo === ".." || repo.endsWith(".") || repo.toLowerCase().endsWith(".git")) {
    return fail(URL_MESSAGES.shape);
  }

  const normalised = `https://github.com/${owner}/${repo}`;
  return { ok: true, repo: { owner, repo, url: normalised, cloneUrl: `${normalised}.git` } };
}
