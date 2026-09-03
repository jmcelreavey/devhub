import type { ResolvedLocalRepo } from "@/lib/repos/resolution";

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
