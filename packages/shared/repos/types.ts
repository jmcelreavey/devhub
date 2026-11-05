/**
 * Client-side view of a repo. Structurally a subset of the server's
 * `lib/repos.RepoInfo`; kept separate so client bundles don't reach into a
 * module that imports node:fs.
 */
export interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  dirtyCount: number;
  remote: string | null;
  unpushedCount?: number;
  /** Last git activity; optional on payloads cached before this field existed. */
  mtimeMs?: number;
  /** Owning repo path when this folder is a git worktree; absent on older payloads. */
  worktreeOf?: string | null;
  worktreeCount?: number | null;
  staleWorktreeCount?: number;
  hasUpstart?: boolean;
  /** Absolute path to the DevHub-managed upstart script (may not exist yet). */
  upstartPath?: string;
  /** Optional: absent on payloads cached before repo health existed. */
  health?: {
    score: number;
    level: "good" | "warn" | "bad";
    reasons: string[];
    /** Data-loss reasons only — what the card actually renders. */
    risks: string[];
  };
}

export interface ReposApiPayload {
  repos: RepoInfo[];
  scanDirDisplay: string;
  protectedRepoName?: string;
}

export interface GithubRepoInfo {
  name: string;
  fullName: string;
  owner: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string | null;
  localRepoName: string | null;
}

export interface GithubReposApiPayload {
  repos: GithubRepoInfo[];
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: string | null;
}

export interface ChangedFileInfo {
  path: string;
  status: string;
}

export interface UnpushedCommitInfo {
  hash: string;
  subject: string;
  files: string[];
}

export interface BranchesApiPayload {
  branches: BranchInfo[];
  currentBranch: string;
  stashCount: number;
  hasChanges: boolean;
  changedFiles: ChangedFileInfo[];
  unpushedCommits: UnpushedCommitInfo[];
}

/** HTTP 409 body when stash pop/apply — or a branch merge — leaves conflicts. */
export interface StashConflictPayload {
  code: "stash_conflict";
  action:
    | "checkout"
    | "stash-apply"
    | "sync-main"
    | "merge-branch"
    | "cherry-pick"
    | "revert"
    | "pull-rebase"
    | "pull-merge"
    | "rebase";
  branch?: string;
  switched: boolean;
  conflictFiles: string[];
  error: string;
  syncTarget?: string;
  stashed?: boolean;
}

/** HTTP 409 body when checkout would overwrite local work. */
export interface CheckoutConflictPayload {
  code: "checkout_would_conflict";
  branch: string;
  error: string;
  /** Untracked-file collisions cannot be represented as merge conflicts safely. */
  canMerge: boolean;
}

/** HTTP 422 body when a git hook blocks commit/push/amend. */
export type { GitHookFailurePayload } from "../git/hook-failure.ts";

export interface RepoSnippet {
  relativePath: string;
  text: string;
}

export interface RepoContextPayload {
  repoName: string;
  repoPath: string;
  scannedAt: string;
  headline: string;
  primaryStack: string[];
  packageManager: string | null;
  scripts: Record<string, string>;
  keyDirectories: string[];
  docs: string[];
  manifests: string[];
  testCommands: string[];
  runCommands: string[];
  recentCommits: string[];
  languageBreakdown: { extension: string; count: number }[];
  openCodePrompt: string;
  scope?: { id: string; label: string; paths: string[] };
}

export interface RepoLearnPackFileMeta {
  path: string;
  sizeBytes: number;
}

export interface RepoLearnArtifactsPayload {
  briefMarkdown: string;
  packFiles: RepoLearnPackFileMeta[];
  overviewMarkdown: string | null;
  generatedAt: string;
  cached: boolean;
}

export interface RepoLearnApiPayload {
  ok: boolean;
  context: RepoContextPayload;
  gitHead: string;
  aiConfigured: boolean;
  artifacts: RepoLearnArtifactsPayload | null;
  code?: "not_configured" | "error";
  message?: string;
  ownership?: import("./ownership-types.ts").RepoOwnershipEvidence;
}

/** An open task shown on a /repos card, tags stripped for the one-line preview. */
export interface RepoTaskPreview {
  id: string;
  text: string;
  jiraKey?: string;
  status?: string;
  needsYou?: boolean;
}

/** Which local repos the /repos grid is narrowed to; null shows all of them. */
export type LocalRepoFilter = "changed" | "unpushed" | "worktree" | null;

/** One row in the Git hub's repository rail. */
export interface RepoGitOverviewRepo {
  name: string;
  path: string;
  branch: string | null;
  upstream: string | null;
  /** Commits ahead of upstream (unpushed). */
  ahead: number;
  /** Commits behind upstream (needs pull). */
  behind: number;
  /** Visible changed files (noise paths excluded). */
  dirtyCount: number;
  /** Unmerged paths left by a failed merge/rebase/cherry-pick. */
  conflictCount: number;
  /** HEAD reflog mtime — rough "last touched" ordering. */
  lastActivityMs: number;
  /** True when git status itself failed; counters are zero and must not be trusted as "clean". */
  error?: boolean;
}

/** Cross-repo snapshot behind the Git hub rail. */
export interface RepoGitOverviewPayload {
  scanDir: string;
  repos: RepoGitOverviewRepo[];
  scannedAt: string;
}
