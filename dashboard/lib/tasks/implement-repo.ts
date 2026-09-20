import type { ResolvedLocalRepo } from "@/lib/repos/resolution";

export function selectListedRepo<T extends { name: string; path: string }>(
  repos: T[],
  opts: { cwd?: string; repoName?: string },
): T | null {
  if (opts.cwd) {
    const byPath = repos.find((repo) => repo.path === opts.cwd);
    if (byPath) return byPath;
  }
  const repoId = opts.repoName?.trim();
  if (!repoId) return null;
  const normalizedId = repoId.toLowerCase();
  const canonicalName = normalizedId.split("/").at(-1) ?? normalizedId;
  const matches = repos.filter((repo) => {
    const name = repo.name.toLowerCase();
    return name === normalizedId || name === canonicalName;
  });
  return matches.find((repo) => repo.name.toLowerCase() === canonicalName) ?? matches[0] ?? null;
}

export function selectTaskImplementationRepo(
  repoId: string,
  localRepos: ResolvedLocalRepo[],
): ResolvedLocalRepo | null {
  const normalizedId = repoId.toLowerCase();
  const canonicalName = normalizedId.split("/").at(-1);
  const matches = localRepos.filter(({ fullName, repo }) =>
    fullName.toLowerCase() === normalizedId ||
    (!normalizedId.includes("/") && repo.name.toLowerCase() === normalizedId),
  );

  return matches.find(({ repo }) => repo.name.toLowerCase() === canonicalName) ?? matches[0] ?? null;
}
