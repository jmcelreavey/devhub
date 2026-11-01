/**
 * Parsing and selection for git remotes.
 *
 * `origin` was assumed throughout: `push -u origin`, `origin/<branch>` for
 * upstreams, and the web-link builder read the origin URL out of the config
 * directly. That works for the common case and fails completely for the other
 * one — contributing to a repo you cannot push to, where `origin` is your fork
 * and `upstream` is the real thing.
 */

export interface Remote {
  name: string;
  fetchUrl: string;
  /** Usually the same as fetchUrl; differs when push is separately configured. */
  pushUrl: string;
}

/**
 * Parse `git remote -v`, which prints one line per name per direction:
 *
 *   origin  git@github.com:me/fork.git (fetch)
 *   origin  git@github.com:me/fork.git (push)
 */
export function parseRemotes(stdout: string): Remote[] {
  const byName = new Map<string, Remote>();
  for (const line of stdout.split("\n")) {
    const match = /^(\S+)\s+(.+?)\s+\((fetch|push)\)\s*$/.exec(line.trim());
    if (!match) continue;
    const [, name = "", url = "", direction = ""] = match;
    const existing = byName.get(name) ?? { name, fetchUrl: "", pushUrl: "" };
    if (direction === "fetch") existing.fetchUrl = url;
    else existing.pushUrl = url;
    byName.set(name, existing);
  }
  // A remote with only one direction configured still has a usable URL.
  for (const remote of byName.values()) {
    remote.fetchUrl ||= remote.pushUrl;
    remote.pushUrl ||= remote.fetchUrl;
  }
  return [...byName.values()].sort((a, b) => {
    // `origin` first — it is still the default for almost every repo — then
    // alphabetically, so the list does not reorder itself between calls.
    if (a.name === "origin") return -1;
    if (b.name === "origin") return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Remote name out of an upstream ref like `upstream/main`. */
export function remoteOfUpstream(upstream: string | null, remotes: Remote[]): string | null {
  if (!upstream) return null;
  // Longest name first: a remote called `origin` and one called `origin-fork`
  // both prefix-match `origin-fork/main`, and only the longer one is right.
  const sorted = [...remotes].sort((a, b) => b.name.length - a.name.length);
  for (const remote of sorted) {
    if (upstream.startsWith(`${remote.name}/`)) return remote.name;
  }
  return null;
}

/**
 * Which remote a web link should point at.
 *
 * The branch's own upstream when it has one, because that is where the code
 * actually lives — linking a fork's branch to the upstream repo produces a 404.
 * Falls back to `origin`, then to whatever single remote exists.
 */
export function webLinkRemote(
  remotes: Remote[],
  upstream: string | null,
): Remote | null {
  const fromUpstream = remoteOfUpstream(upstream, remotes);
  if (fromUpstream) {
    const match = remotes.find((r) => r.name === fromUpstream);
    if (match) return match;
  }
  return remotes.find((r) => r.name === "origin") ?? remotes[0] ?? null;
}

/**
 * Remote names are interpolated into git argv and into ref strings, so accept
 * only what git itself allows: no whitespace, no path separators, no leading
 * dash that could be read as an option.
 */
export function isSafeRemoteName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) return false;
  if (trimmed.startsWith("-")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed);
}

/**
 * Remote URLs also reach git argv. Allow the shapes git actually takes and
 * reject a leading dash, which is the only way this becomes an option rather
 * than a value.
 */
export function isSafeRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (trimmed.startsWith("-")) return false;
  return (
    /^(https?|ssh|git|file):\/\//.test(trimmed) ||
    /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(trimmed) ||
    trimmed.startsWith("/")
  );
}
