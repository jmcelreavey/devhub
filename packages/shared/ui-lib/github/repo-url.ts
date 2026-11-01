/**
 * Helpers for extracting `owner/name` from the various GitHub URL shapes we
 * encounter in `gh` output. Previously these regexes were duplicated across
 * `github-prs.ts`, `standup-github-merged.ts`, and `repos.ts`.
 *
 * Shapes handled:
 *   - Search API:        https://api.github.com/repos/owner/name
 *   - PR html_url:       https://github.com/owner/name/pull/123
 *   - Remote URL (SSH):  git@github.com:owner/name.git
 *   - Remote URL (HTTP): https://github.com/owner/name.git
 */

const FALLBACK = "?";

/** `https://api.github.com/repos/owner/name` → `owner/name` */
export function parseRepoFullNameFromApiUrl(repositoryUrl: string | undefined): string {
  if (!repositoryUrl) return FALLBACK;
  const m = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)$/i);
  return m?.[1] ?? FALLBACK;
}

/** `https://github.com/owner/name/pull/123` → `owner/name` */
export function parseRepoFullNameFromPrUrl(prUrl: string): string {
  const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\//i);
  return m?.[1] ?? FALLBACK;
}

/** Normalize an `origin` remote URL (SSH or HTTPS) to its HTTPS form. */
export function normalizeGithubRemote(raw: string): string {
  return raw.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
}

/** Extract `owner/name` from any origin remote URL. Returns null if not GitHub. */
export function parseRepoFullNameFromRemote(remote: string | null): string | null {
  if (!remote) return null;
  const normalized = normalizeGithubRemote(remote);
  const match = normalized.match(/github\.com\/([^/]+\/[^/]+)$/i);
  return match?.[1] ?? null;
}
