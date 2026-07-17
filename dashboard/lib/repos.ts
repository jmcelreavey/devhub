import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getHome, getRepoRoot } from "./notes-dir";
import { execGhJsonLines, isGithubCliAuthenticated } from "./gh-exec";
import { parseRepoFullNameFromRemote } from "./github-repo-url";
import { gitUnpushedCount } from "./standup-git";
import { countVisibleDirtyFromPorcelain } from "./repo-git-parsers";
import { detectRepoUpstart, safeUpstartScriptPath } from "./repo-upstart";

const execFileAsync = promisify(execFile);

export { isGithubCliAuthenticated };
const SEARCH_RESULTS_TTL_MS = 30 * 1000;
const ACCESSIBLE_REPOS_TTL_MS = 5 * 60 * 1000;
const searchResultsCache = new Map<string, { repos: GithubRepoInfo[]; expiresAt: number }>();
let cachedAccessibleRepos:
  | { repos: GhApiRepo[]; expiresAt: number }
  | null = null;

export interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  remote: string | null;
  dirtyCount: number;
  unpushedCount: number;
  /** DevHub private mirror has a reusable upstart script for this repo. */
  hasUpstart: boolean;
  /** Absolute path to the DevHub-managed upstart script (may not exist yet). */
  upstartPath: string;
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

function readHead(repoPath: string): string | null {
  try {
    const head = fs.readFileSync(path.join(repoPath, ".git", "HEAD"), "utf-8").trim();
    if (head.startsWith("ref: refs/heads/")) return head.slice("ref: refs/heads/".length);
    return head.slice(0, 8); // detached HEAD
  } catch {
    return null;
  }
}

function readRemote(repoPath: string): string | null {
  try {
    const config = fs.readFileSync(path.join(repoPath, ".git", "config"), "utf-8");
    const match = config.match(/url\s*=\s*(.+)/);
    if (!match) return null;
    const url = match[1].trim();
    // Normalise SSH to HTTPS for display
    return url.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  } catch {
    return null;
  }
}

/** `owner/name` for a local clone whose `origin` points at github.com, or null. */
export function getGithubFullNameForLocalRepo(repoPath: string): string | null {
  return parseRepoFullNameFromRemote(readRemote(repoPath));
}

async function getDirtyCount(repoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/git", [
      "-C", repoPath, "status", "--porcelain",
    ]);
    // Match the Git workspace UI: .DS_Store / __pycache__ don't count as "changed".
    return countVisibleDirtyFromPorcelain(stdout);
  } catch {
    return 0;
  }
}

function sanitizeRepoDirName(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed) || trimmed.includes("..")) {
    throw new Error("Invalid local repo name");
  }
  return trimmed;
}

function resolveDirectChild(baseDir: string, childName: string): string {
  const childPath = path.join(baseDir, childName);
  const resolved = path.resolve(childPath);
  if (path.dirname(resolved) !== path.resolve(baseDir)) {
    throw new Error("Invalid repo path");
  }
  return resolved;
}

/** Directory that contains sibling git repos (parent of this devhub checkout). */
export function getReposScanDir(): string {
  return path.dirname(getRepoRoot());
}

/** HOME-relative display path when under $HOME, else absolute. */
export function formatPathWithTilde(absolute: string): string {
  const home = getHome();
  if (absolute === home) return "~";
  const prefix = home + path.sep;
  if (absolute.startsWith(prefix)) {
    return "~" + absolute.slice(home.length);
  }
  return absolute;
}

export async function listRepos(): Promise<RepoInfo[]> {
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return [];

  const entries = fs.readdirSync(scanDir, { withFileTypes: true });
  const repos: RepoInfo[] = [];

  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(scanDir, e.name, ".git")))
      .map(async (e) => {
        const repoPath = path.join(scanDir, e.name);
        const [dirtyCount, unpushedCount] = await Promise.all([
          getDirtyCount(repoPath),
          gitUnpushedCount(repoPath),
        ]);
        repos.push({
          name: e.name,
          path: repoPath,
          branch: readHead(repoPath),
          remote: readRemote(repoPath),
          hasUpstart: detectRepoUpstart(e.name, repoPath),
          upstartPath: safeUpstartScriptPath(e.name),
          dirtyCount,
          unpushedCount,
        });
      })
  );

  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

interface GhApiRepo {
  name: string;
  fullName: string;
  owner: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string | null;
}

async function getLocalGithubMappings(): Promise<Map<string, string>> {
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return new Map();

  const entries = fs.readdirSync(scanDir, { withFileTypes: true });
  const mappings = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(scanDir, entry.name);
    if (!fs.existsSync(path.join(repoPath, ".git"))) continue;
    const fullName = parseRepoFullNameFromRemote(readRemote(repoPath));
    if (!fullName) continue;
    mappings.set(fullName.toLowerCase(), entry.name);
  }

  return mappings;
}

async function getAccessibleGithubRepos(): Promise<GhApiRepo[]> {
  const now = Date.now();
  if (cachedAccessibleRepos && cachedAccessibleRepos.expiresAt > now) {
    return cachedAccessibleRepos.repos;
  }

  const repos = await execGhJsonLines<GhApiRepo>([
    "api",
    "--paginate",
    "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member",
    "--jq",
    ".[] | {name: .name, fullName: .full_name, owner: .owner.login, url: .html_url, description: .description, isPrivate: .private, defaultBranch: .default_branch}",
  ]);
  cachedAccessibleRepos = { repos, expiresAt: now + ACCESSIBLE_REPOS_TTL_MS };
  return repos;
}

export async function listGithubRepos(query?: string): Promise<GithubRepoInfo[]> {
  const normalizedQuery = query?.trim();
  if (!normalizedQuery) {
    return [];
  }

  const now = Date.now();
  const cached = searchResultsCache.get(normalizedQuery.toLowerCase());
  if (cached && cached.expiresAt > now) {
    return cached.repos;
  }

  const localRepoMappings = await getLocalGithubMappings();
  const repos = await getAccessibleGithubRepos();
  const lowered = normalizedQuery.toLowerCase();
  const result = repos
    .filter((repo) => {
      const haystack = `${repo.fullName} ${repo.description ?? ""}`.toLowerCase();
      return haystack.includes(lowered);
    })
    .map((repo) => {
      const localRepoName = localRepoMappings.get(repo.fullName.toLowerCase()) ?? null;
      return {
        ...repo,
        localRepoName,
      } satisfies GithubRepoInfo;
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  searchResultsCache.set(normalizedQuery.toLowerCase(), {
    repos: result,
    expiresAt: now + SEARCH_RESULTS_TTL_MS,
  });

  return result;
}

/**
 * Every accessible GitHub repo (owner/collaborator/org member), each tagged with
 * its local clone name when one exists. Used by Capability Radar to scan
 * un-cloned repos remotely. Reuses the same 5-min cache as the search path.
 */
export async function listAccessibleGithubRepos(): Promise<GithubRepoInfo[]> {
  const [localRepoMappings, repos] = await Promise.all([
    getLocalGithubMappings(),
    getAccessibleGithubRepos(),
  ]);
  return repos
    .map((repo) => ({
      ...repo,
      localRepoName: localRepoMappings.get(repo.fullName.toLowerCase()) ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function sanitizeGithubFullName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error("Invalid GitHub repo");
  }
  return trimmed;
}

export async function cloneGithubRepo(fullName: string): Promise<{ name: string; path: string }> {
  const sanitizedFullName = sanitizeGithubFullName(fullName);
  const [, repoName] = sanitizedFullName.split("/");
  const scanDir = getReposScanDir();
  const sanitizedRepoName = sanitizeRepoDirName(repoName);
  const destinationPath = resolveDirectChild(scanDir, sanitizedRepoName);

  if (fs.existsSync(destinationPath)) {
    throw new Error(`Local folder already exists: ${sanitizedRepoName}`);
  }

  await execFileAsync("/usr/bin/git", [
    "clone",
    `https://github.com/${sanitizedFullName}.git`,
    destinationPath,
  ]);

  return { name: sanitizedRepoName, path: destinationPath };
}

export function deleteLocalRepo(name: string): { name: string; path: string } {
  const scanDir = getReposScanDir();
  const sanitizedName = sanitizeRepoDirName(name);
  const repoPath = resolveDirectChild(scanDir, sanitizedName);
  const currentRepoName = path.basename(getRepoRoot());

  if (sanitizedName === currentRepoName) {
    throw new Error("Refusing to delete current devhub repo");
  }
  if (!fs.existsSync(repoPath)) {
    throw new Error("Repo not found");
  }
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    throw new Error("Target is not a git repo");
  }

  fs.rmSync(repoPath, { recursive: true, force: true });
  return { name: sanitizedName, path: repoPath };
}
