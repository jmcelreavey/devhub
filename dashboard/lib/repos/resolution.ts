import { getGithubFullNameForLocalRepo, listRepos, type RepoInfo } from "@/lib/repos";

export interface ResolvedLocalRepo {
  fullName: string;
  repo: RepoInfo;
}

const TTL_MS = 60_000;
let cache: { expiresAt: number; value: Promise<ResolvedLocalRepo[]> } | null = null;

export function invalidateLocalRepoResolution(): void {
  cache = null;
}

export function resolveLocalGithubRepos(): Promise<ResolvedLocalRepo[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const value = listRepos().then((repos) => repos.flatMap((repo) => {
    const fullName = getGithubFullNameForLocalRepo(repo.path);
    return fullName ? [{ fullName, repo }] : [];
  })).catch((error: unknown) => {
    cache = null;
    throw error;
  });
  cache = { expiresAt: Date.now() + TTL_MS, value };
  return value;
}
