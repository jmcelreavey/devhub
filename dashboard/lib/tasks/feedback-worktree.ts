import { ensureRunWorktree } from "@/lib/agent-runs/git";
import { readAgentRun } from "@/lib/agent-runs/store";
import type { AgentRunWorktree } from "@/lib/agent-runs/run-files";
import type { PrFeedbackSnapshot } from "@/lib/github/finished-task-feedback";
import { defaultWorktreePath } from "@/lib/repos/worktree-parsers";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";
import { selectTaskImplementationRepo } from "./implement-repo";
import { latestImplementationRun, listTaskAgentRuns } from "./task-agent-runs";
import type { Task } from "./types";
import { StoryboardError } from "@/lib/storyboard/errors";

export interface FeedbackWork {
  cwd: string;
  worktree?: AgentRunWorktree;
  baseSha?: string;
}

export async function restoreFeedbackWork(task: Task, snapshot: PrFeedbackSnapshot | undefined, saved?: FeedbackWork): Promise<FeedbackWork | undefined> {
  const latest = latestImplementationRun(listTaskAgentRuns(task.id));
  const prior = latest ? readAgentRun(latest.runId) : null;
  const work = saved ?? (prior ? { cwd: prior.spec.cwd, worktree: prior.spec.worktree, baseSha: prior.spec.baseSha } : undefined);
  try {
    if (work?.worktree) return { ...work, ...await ensureRunWorktree(work) };
    const branch = latest?.branch ?? snapshot?.headBranch;
    const repoId = snapshot?.repo ?? (latest?.branch ? task.links?.find((link) => link.kind === "repo")?.id : undefined);
    if (branch && repoId) {
      const resolved = selectTaskImplementationRepo(repoId, await resolveLocalGithubRepos());
      if (!resolved) throw new Error("The linked repository is not available locally.");
      const target = defaultWorktreePath(resolved.repo.path, branch);
      return ensureRunWorktree({ cwd: target, worktree: { path: target, branch, repoRoot: resolved.repo.path } });
    }
    if (work) return { ...work, ...await ensureRunWorktree(work) };
    throw new Error("No saved branch is available for this PR. Restore its checkout before starting feedback work.");
  } catch (error) {
    throw new StoryboardError(`Could not restore feedback work: ${error instanceof Error ? error.message : "Unknown worktree error"}`, 409);
  }
}
