/** `owner/name` as GitHub writes it: alphanumerics, dot, dash, underscore. */
const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface OwnerRepo {
  owner: string;
  name: string;
}

/** Split a `owner/name` repo into its parts, or null when it isn't one. */
export function parseOwnerRepo(repo: string): OwnerRepo | null {
  const trimmed = repo.trim();
  if (!REPO_FULL_NAME_RE.test(trimmed)) return null;
  const slash = trimmed.indexOf("/");
  const owner = trimmed.slice(0, slash);
  const name = trimmed.slice(slash + 1);
  if (!owner || !name) return null;
  return { owner, name };
}
