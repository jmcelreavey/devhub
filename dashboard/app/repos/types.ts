export interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  dirtyCount: number;
  remote: string | null;
  unpushedCount?: number;
  hasCompose?: boolean;
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

export interface RepoLearningProfile {
  repoName: string;
  repoPath: string;
  generatedAt: string;
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
  briefMarkdown: string;
  notebookPackMarkdown: string;
  openCodePrompt: string;
  quiz: RepoQuizQuestion[];
}

export interface RepoQuizQuestion {
  id: string;
  question: string;
  answer: string;
  source: string | null;
}

export interface RepoLearnApiPayload {
  profile: RepoLearningProfile;
}
