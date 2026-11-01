import { runGitRepoAsync } from "../git/repo-local";

export async function stageCollectedPath(repoRoot: string, relativePath: string): Promise<void> {
  const result = await runGitRepoAsync(repoRoot, ["add", "--", relativePath]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git add failed");
  }
}
