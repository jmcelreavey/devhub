/**
 * Which local worktrees are finished with, and the evidence for saying so.
 *
 * Worktrees accumulate silently: every agent run makes one, every PR checkout
 * makes one, and until now nothing removed them. Listing them is not enough to
 * act on — a list of twelve paths still leaves you diffing each one by hand.
 * What makes a row actionable is a reason to believe the work is over, so this
 * only reports a worktree when one of three things is true:
 *
 * - its branch has a merged PR,
 * - it belongs to an agent run that has stopped,
 * - its folder is already gone and git just needs to forget it.
 *
 * Anything else — a branch you are still on, a run still going, a worktree you
 * locked — is deliberately left out rather than listed with a shrug. The two
 * kinds of evidence are not interchangeable: agent branches (`devhub/agent/*`)
 * are never pushed, so they will never have a merged PR, and a hand-made
 * worktree has no run record. Each needs its own signal.
 */
import fs from "node:fs";
import path from "node:path";
import { isActiveAgentRunState, type AgentRunState } from "@/lib/agent-runs/run-files";
import { listAgentRuns } from "@/lib/agent-runs/store";
import { execGhJsonArray } from "@/lib/gh-exec";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { pMap } from "@/lib/p-limit";
import { getGithubFullNameForLocalRepo, getReposScanDir } from "@/lib/repos";
import { parseWorktreeList, type Worktree } from "@/lib/repos/worktree-parsers";
import { SUBPROCESS_CONCURRENCY } from "@/lib/standup/config";

/** Enough history to cover worktrees left over from older runs. */
const RUN_HISTORY_LIMIT = 200;
/** Merged PRs to consider per repo. Older than this and the worktree is ancient anyway. */
const MERGED_PR_LIMIT = 100;

export type WorktreeCleanupReason = "pr-merged" | "run-finished" | "folder-missing";

export interface WorktreeCleanupPr {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
}

export interface WorktreeCleanupRow {
  /** Local repo folder name, as `repos_list` shows it. */
  repo: string;
  repoPath: string;
  /** The worktree's own folder — what gets removed. */
  path: string;
  branch: string | null;
  reason: WorktreeCleanupReason;
  pr?: WorktreeCleanupPr;
  run?: { id: string; state: AgentRunState; finishedAt?: number };
}

export interface WorktreeCleanupResult {
  rows: WorktreeCleanupRow[];
  /** Worktrees seen but deliberately not offered (in use, locked, or no evidence). */
  kept: number;
  /** Repos whose worktrees or PRs could not be read. */
  failedRepos: string[];
}

interface ScannedRepo {
  name: string;
  path: string;
}

/**
 * Direct children of the repos dir that are git repositories.
 *
 * Mirrors `listRepos` but skips its per-repo dirty/unpushed counts, which are
 * several git calls each and irrelevant here. Dot-directories are skipped so
 * the agent worktree root itself is never treated as a repo.
 */
function scannedRepos(): ScannedRepo[] {
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return [];
  try {
    return fs
      .readdirSync(scanDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          fs.existsSync(path.join(scanDir, entry.name, ".git")),
      )
      .map((entry) => ({ name: entry.name, path: path.join(scanDir, entry.name) }));
  } catch {
    return [];
  }
}

/** Agent runs keyed by the worktree they were given, newest last write wins. */
function runsByWorktreePath(): Map<string, { id: string; state: AgentRunState; finishedAt?: number }> {
  const map = new Map<string, { id: string; state: AgentRunState; finishedAt?: number }>();
  for (const run of listAgentRuns(RUN_HISTORY_LIMIT)) {
    const worktreePath = run.spec.worktree?.path;
    if (!worktreePath) continue;
    map.set(worktreePath.replace(/\/+$/, ""), {
      id: run.spec.id,
      state: run.status.state,
      finishedAt: run.status.finishedAt,
    });
  }
  return map;
}

interface GhMergedPr {
  headRefName?: string;
  number?: number;
  title?: string;
  url?: string;
  mergedAt?: string;
}

/**
 * Merged PRs for a repo, keyed by head branch.
 *
 * Not filtered by author: a worktree you made to review someone else's PR is
 * just as finished once that PR merges.
 */
async function mergedPrsByBranch(repo: ScannedRepo): Promise<Map<string, WorktreeCleanupPr>> {
  const fullName = getGithubFullNameForLocalRepo(repo.path);
  if (!fullName) return new Map();

  const rows = await execGhJsonArray<GhMergedPr>([
    "pr",
    "list",
    "-R",
    fullName,
    "--state",
    "merged",
    "--limit",
    String(MERGED_PR_LIMIT),
    "--json",
    "headRefName,number,title,url,mergedAt",
  ]);

  const byBranch = new Map<string, WorktreeCleanupPr>();
  for (const row of rows) {
    if (!row.headRefName || !row.url || typeof row.number !== "number") continue;
    // `gh` returns newest first; keep the first (most recent) merge per branch.
    if (byBranch.has(row.headRefName)) continue;
    byBranch.set(row.headRefName, {
      number: row.number,
      title: row.title ?? "",
      url: row.url,
      mergedAt: row.mergedAt ?? "",
    });
  }
  return byBranch;
}

/** The evidence test. Returns null for anything that should be left alone. */
function classify(
  repo: ScannedRepo,
  tree: Worktree,
  merged: Map<string, WorktreeCleanupPr>,
  runs: Map<string, { id: string; state: AgentRunState; finishedAt?: number }>,
): WorktreeCleanupRow | null {
  // Locking a worktree is an explicit "do not touch", so honour it over any
  // evidence that the work is done.
  if (tree.locked) return null;

  const base = {
    repo: repo.name,
    repoPath: repo.path,
    path: tree.path,
    branch: tree.branch,
  };

  if (tree.prunable) return { ...base, reason: "folder-missing" };

  const run = runs.get(tree.path.replace(/\/+$/, ""));
  if (run) {
    // An agent branch is never pushed, so a run record is the only signal it
    // will ever have. Still going means still needed.
    return isActiveAgentRunState(run.state) ? null : { ...base, reason: "run-finished", run };
  }

  const pr = tree.branch ? merged.get(tree.branch) : undefined;
  return pr ? { ...base, reason: "pr-merged", pr } : null;
}

/**
 * Scan every local repo for worktrees that are done with.
 *
 * One `git worktree list` per repo, and one `gh pr list` only for the repos
 * that actually have a worktree besides their own checkout — which is most of
 * them none of the time.
 */
export async function listWorktreeCleanup(): Promise<WorktreeCleanupResult> {
  const repos = scannedRepos();
  const runs = runsByWorktreePath();
  const failedRepos: string[] = [];
  let kept = 0;

  const perRepo = await pMap(repos, SUBPROCESS_CONCURRENCY, async (repo) => {
    const list = await runGitRepoAsync(repo.path, ["worktree", "list", "--porcelain"]);
    if (list.status !== 0) {
      failedRepos.push(repo.name);
      return [] as WorktreeCleanupRow[];
    }

    const extra = parseWorktreeList(list.stdout || "").filter((tree) => !tree.isMain);
    if (extra.length === 0) return [] as WorktreeCleanupRow[];

    // Only pay for GitHub when a branch could plausibly need it.
    const needsPrLookup = extra.some((tree) => tree.branch && !runs.has(tree.path.replace(/\/+$/, "")));
    let merged = new Map<string, WorktreeCleanupPr>();
    if (needsPrLookup) {
      try {
        merged = await mergedPrsByBranch(repo);
      } catch {
        // A repo with no GitHub remote, or an unauthenticated gh, must not hide
        // the run-finished and folder-missing rows we can still report.
        failedRepos.push(repo.name);
      }
    }

    const rows: WorktreeCleanupRow[] = [];
    for (const tree of extra) {
      const row = classify(repo, tree, merged, runs);
      if (row) rows.push(row);
      else kept += 1;
    }
    return rows;
  });

  const rows = perRepo.flat().sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path));
  return { rows, kept, failedRepos };
}

export interface RemoveWorktreeOutcome {
  ok: boolean;
  error?: string;
  /** Git refused because the tree has changes; the caller may offer force. */
  dirty?: boolean;
}

/**
 * Remove one worktree, keeping its branch and commits.
 *
 * `target` is checked against the repo's own worktree list rather than trusted,
 * so a bad path cannot reach `git worktree remove` as an argument, and the main
 * working tree can never be the target.
 */
export async function removeWorktreeAt(
  repoPath: string,
  target: string,
  force = false,
): Promise<RemoveWorktreeOutcome> {
  const wanted = target.trim().replace(/\/+$/, "");
  if (!wanted) return { ok: false, error: "No worktree given" };

  const list = await runGitRepoAsync(repoPath, ["worktree", "list", "--porcelain"]);
  if (list.status !== 0) return { ok: false, error: list.stderr.trim() || "Could not list worktrees" };

  const match = parseWorktreeList(list.stdout || "").find(
    (tree) => tree.path.replace(/\/+$/, "") === wanted,
  );
  if (!match) return { ok: false, error: "That is not a worktree of this repository." };
  if (match.isMain) {
    return { ok: false, error: "That is the repository's own working tree and cannot be removed." };
  }

  // A missing folder only needs the administrative entry cleared.
  if (match.prunable) {
    const pruned = await runGitRepoAsync(repoPath, ["worktree", "prune"]);
    return pruned.status === 0
      ? { ok: true }
      : { ok: false, error: pruned.stderr.trim() || "Could not prune worktrees" };
  }

  const result = await runGitRepoAsync(repoPath, [
    "worktree",
    "remove",
    ...(force ? ["--force"] : []),
    "--",
    match.path,
  ]);
  if (result.status === 0) return { ok: true };

  const dirty = /contains modified or untracked files/i.test(result.stderr);
  return { ok: false, error: result.stderr.trim() || "Could not remove the worktree", dirty };
}
