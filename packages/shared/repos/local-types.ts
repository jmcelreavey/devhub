export type HealthLevel = "good" | "warn" | "bad";

export interface RepoHealth {
  score: number;
  level: HealthLevel;
  /** Human-readable reasons, worst first. Empty when nothing is wrong. */
  reasons: string[];
  /**
   * The subset of `reasons` representing possible **data loss** — unpushed
   * commits, no remote, uncommitted work, detached HEAD.
   *
   * This split exists because the first version scored honestly and then
   * rendered every reason, which lit up 38 of 52 real repos, mostly with "no
   * activity in N days". On a machine with 52 checkouts most being dormant is
   * normal, and a warning on three quarters of the list is decoration, not
   * triage. Staleness and missing CI still move the score; they just don't earn
   * a line on the card.
   */
  risks: string[];
}

export interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  remote: string | null;
  dirtyCount: number;
  unpushedCount: number;
  /**
   * Last git activity (`.git/logs/HEAD` mtime), else clone-path mtime.
   * Used to put recently touched clones first on /repos.
   */
  mtimeMs: number;
  /**
   * Owning repository path when this folder is a git worktree, else null.
   * Worktrees list as repos of their own, so this is what tells them apart.
   */
  worktreeOf: string | null;
  worktreeCount?: number | null;
  staleWorktreeCount?: number;
  /** DevHub private mirror has a reusable upstart script for this repo. */
  hasUpstart: boolean;
  /** Absolute path to the DevHub-managed upstart script (may not exist yet). */
  upstartPath: string;
  /**
   * Cheap working-copy triage score. Computed from the filesystem only - see
   * lib/repos/health.ts for what is deliberately NOT included and why.
   */
  health: RepoHealth;
}

export interface ResolvedLocalRepo {
  fullName: string;
  repo: RepoInfo;
}

