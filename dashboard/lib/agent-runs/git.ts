/**
 * Git around agent runs: the diff baseline, optional isolated worktrees, and
 * the diff itself.
 */
import fs from "node:fs";
import path from "node:path";
import { clip } from "@/lib/agent-runs/events";
import type { AgentRunSpec, AgentRunWorktree } from "@/lib/agent-runs/run-files";
import { runGitRepoAsync } from "@/lib/git/repo-local";

const PATCH_MAX = 60_000;

export async function gitHead(cwd: string): Promise<string | undefined> {
  const r = await runGitRepoAsync(cwd, ["rev-parse", "HEAD"]);
  return r.status === 0 ? r.stdout.trim() || undefined : undefined;
}

/**
 * A worktree on a fresh `devhub/agent/<run>` branch, kept under the repo's git
 * dir so it never shows in the checkout, IDE file tree, or repo scans. Used when
 * several agents work the same repo at once; otherwise runs edit the checkout
 * the user already has open.
 */
export async function createRunWorktree(
  cwd: string,
  runId: string,
): Promise<{ worktree: AgentRunWorktree; baseSha: string; cwd: string }> {
  const top = await runGitRepoAsync(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new Error(`worktree: ${cwd} is not inside a git repository`);
  const repoRoot = top.stdout.trim();

  const baseSha = await gitHead(repoRoot);
  if (!baseSha) throw new Error(`worktree: ${repoRoot} has no commits to branch from`);

  const common = await runGitRepoAsync(repoRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.status !== 0) throw new Error(`worktree: ${common.stderr.trim() || "could not resolve the git dir"}`);

  const worktreePath = path.join(common.stdout.trim(), "devhub-worktrees", runId);
  const branch = `devhub/agent/${runId}`;
  const add = await runGitRepoAsync(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseSha]);
  if (add.status !== 0) throw new Error(`worktree: ${add.stderr.trim() || "git worktree add failed"}`);

  // Keep the agent in the same subdirectory it was asked to work in.
  const relative = path.relative(fs.realpathSync(repoRoot), fs.realpathSync(cwd));
  return { worktree: { path: worktreePath, branch, repoRoot }, baseSha, cwd: path.join(worktreePath, relative) };
}

export interface AgentRunDiff {
  cwd: string;
  baseSha: string | null;
  stat: string;
  patch: string | null;
  untracked: string[];
  truncated: boolean;
  note: string | null;
}

/** Working tree against HEAD-at-dispatch, so commits the agent made are included. */
export async function agentRunDiff(spec: AgentRunSpec, includePatch: boolean): Promise<AgentRunDiff> {
  const cwd = spec.worktree?.path ?? spec.cwd;
  if (!spec.baseSha) {
    return {
      cwd,
      baseSha: null,
      stat: "",
      patch: null,
      untracked: [],
      truncated: false,
      note: "Not a git repository (or no commits) when dispatched, so there is no diff baseline.",
    };
  }
  const [stat, untracked, patch] = await Promise.all([
    runGitRepoAsync(cwd, ["diff", "--stat", spec.baseSha]),
    runGitRepoAsync(cwd, ["ls-files", "--others", "--exclude-standard"]),
    includePatch ? runGitRepoAsync(cwd, ["diff", spec.baseSha]) : Promise.resolve(null),
  ]);
  if (stat.status !== 0) throw new Error(stat.stderr.trim() || "git diff failed");
  const fullPatch = patch?.stdout ?? null;
  return {
    cwd,
    baseSha: spec.baseSha,
    stat: stat.stdout.trim(),
    patch: fullPatch === null ? null : clip(fullPatch, PATCH_MAX),
    untracked: untracked.stdout.split("\n").filter(Boolean),
    truncated: (fullPatch?.length ?? 0) > PATCH_MAX,
    note: spec.worktree
      ? null
      : "Shared checkout: this diff is against HEAD at dispatch, so it includes any other edits made there since.",
  };
}
