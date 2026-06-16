import { getGitHead, scanRepoContext, type RepoContext } from "@/lib/repo-context";

const TTL_MS = 60_000;
const cache = new Map<string, { gitHead: string; context: RepoContext; at: number }>();

/** Scan once per repo/HEAD; tutor messages reuse context for ~60s to avoid re-walking the tree every turn. */
export async function getRepoContextForTutor(repoPath: string): Promise<RepoContext> {
  const gitHead = await getGitHead(repoPath);
  const hit = cache.get(repoPath);
  if (hit && hit.gitHead === gitHead && Date.now() - hit.at < TTL_MS) {
    return hit.context;
  }
  const context = await scanRepoContext(repoPath);
  cache.set(repoPath, { gitHead, context, at: Date.now() });
  return context;
}

/** Test-only: clear in-memory tutor context cache. */
export function clearRepoContextForTutorCache(): void {
  cache.clear();
}
