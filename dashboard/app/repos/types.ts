export interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  dirtyCount: number;
  remote: string | null;
  unpushedCount?: number;
  hasUpstart?: boolean;
}

export interface ReposApiPayload {
  repos: RepoInfo[];
  scanDirDisplay: string;
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
}
