/**
 * Git around agent runs: the diff baseline, optional isolated worktrees, and
 * the diff itself.
 */
import fs from "node:fs";
import path from "node:path";
import { clip } from "@/lib/agent-runs/events";
import type { AgentRunSpec, AgentRunWorktree } from "@/lib/agent-runs/run-files";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { getReposScanDir } from "@/lib/repos";
import { worktreePathError,worktreeSlug } from "@/lib/repos/worktree-parsers";

const PATCH_MAX = 60_000;

export async function gitHead(cwd: string): Promise<string | undefined> {
  const r = await runGitRepoAsync(cwd, ["rev-parse", "HEAD"]);
  return r.status === 0 ? r.stdout.trim() || undefined : undefined;
}

export interface AgentWorktreeLabel {
  repoName?: string;
  jiraKey?: string;
  title?: string;
}

/**
 * Folder/branch leaf for an agent worktree.
 *
 * Readable prefix (repo + ticket or task) for the Cursor sidebar, with the
 * run id always as the suffix so resume / task-agent-runs matching can still
 * find `run-…` in the path. Do not drop the suffix.
 */
export function agentWorktreeDirName(
  runId: string,
  repoRoot: string,
  label?: AgentWorktreeLabel,
): string {
  const repo = worktreeSlug(
    label?.repoName?.trim() || path.basename(repoRoot.replace(/\/+$/, "")),
  );
  const ticket = label?.jiraKey?.trim().toUpperCase();
  const task = !ticket && label?.title?.trim()
    ? worktreeSlug(label.title).toLowerCase().slice(0, 40)
    : "";
  const human = ticket
    ? `${repo}-${ticket}`
    : task && task !== "worktree"
      ? `${repo}-${task}`
      : repo && repo !== "worktree"
        ? repo
        : "";
  return human ? `${human}-${runId}` : runId;
}

/**
 * Where agent worktrees live: a hidden folder beside the repos, not inside one.
 *
 * These used to sit under the repo's own `.git/`, which hid them from the IDE
 * tree and repo scans but also hid them from every tool that skips
 * dot-directories — Jest among them, so an agent could not run the suite in the
 * tree it had just edited. A hidden sibling keeps tooling working, and because
 * `listRepos` only accepts direct children of the scan dir that contain a
 * `.git`, neither this folder nor the worktrees one level inside it are listed
 * as repos.
 */
export function agentWorktreeRoot(repoRoot: string): string {
  const repo = path.basename(repoRoot.replace(/\/+$/, ""));
  return path.join(getReposScanDir(), ".devhub-worktrees", repo);
}

/**
 * A worktree on a fresh `devhub/agent/<name>` branch, under
 * {@link agentWorktreeRoot}. Used when several agents work the same repo at
 * once; otherwise runs edit the checkout the user already has open.
 */
export async function createRunWorktree(
  cwd: string,
  runId: string,
  label?: AgentWorktreeLabel,
): Promise<{ worktree: AgentRunWorktree; baseSha: string; cwd: string }> {
  const top = await runGitRepoAsync(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new Error(`worktree: ${cwd} is not inside a git repository`);
  const repoRoot = top.stdout.trim();

  const baseSha = await gitHead(repoRoot);
  if (!baseSha) throw new Error(`worktree: ${repoRoot} has no commits to branch from`);

  const leaf = agentWorktreeDirName(runId, repoRoot, label);
  const worktreePath = path.join(agentWorktreeRoot(repoRoot), leaf);
  // Same rule the manual worktree UI enforces, so both paths agree on what a
  // legal target is rather than each carrying its own idea.
  const pathError = worktreePathError(repoRoot, worktreePath);
  if (pathError) throw new Error(`worktree: ${pathError}`);

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const branch = `devhub/agent/${leaf}`;
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
