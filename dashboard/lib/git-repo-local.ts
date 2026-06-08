import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { augmentedPathEnv } from "./process-env";

const execFileAsync = promisify(execFile);

const GH_GIT_CREDENTIAL_CONFIG = [
  "-c",
  "credential.helper=",
  "-c",
  "credential.helper=!gh auth git-credential",
];

export interface GitRepoRunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

export function gitEnv(): NodeJS.ProcessEnv {
  return augmentedPathEnv({ GIT_TERMINAL_PROMPT: "0" });
}

/** Git commands that talk to remotes and need GitHub CLI credential helper in the dashboard server. */
export function isGitNetworkCommand(args: string[]): boolean {
  const cmd = args[0];
  return cmd === "fetch" || cmd === "pull" || cmd === "push";
}

function gitArgsForRepo(
  repoRoot: string,
  args: string[],
  useGhCredentials: boolean,
): string[] {
  return useGhCredentials
    ? ["-C", repoRoot, ...GH_GIT_CREDENTIAL_CONFIG, ...args]
    : ["-C", repoRoot, ...args];
}

/** Run git in a repo. Network commands default to gh credential helper + augmented PATH. */
export function runGitRepo(
  repoRoot: string,
  args: string[],
  opts?: { useGhCredentials?: boolean },
): GitRepoRunResult {
  const useGh = opts?.useGhCredentials ?? isGitNetworkCommand(args);
  const r = spawnSync("git", gitArgsForRepo(repoRoot, args, useGh), {
    encoding: "utf-8",
    env: gitEnv(),
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status,
  };
}

export async function runGitRepoAsync(
  repoRoot: string,
  args: string[],
  opts?: { useGhCredentials?: boolean; timeout?: number },
): Promise<GitRepoRunResult> {
  const useGh = opts?.useGhCredentials ?? isGitNetworkCommand(args);
  try {
    const { stdout, stderr } = await execFileAsync("git", gitArgsForRepo(repoRoot, args, useGh), {
      env: gitEnv(),
      timeout: opts?.timeout,
    });
    return { stdout, stderr, status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: typeof e.code === "number" ? e.code : 1,
    };
  }
}

function git(repoRoot: string, args: string[]): string | undefined {
  const r = runGitRepo(repoRoot, args);
  if (r.status !== 0) return undefined;
  return r.stdout.trim() || undefined;
}

/** Origin remote URL from `.git/config`, or null. */
export function readOriginRemoteUrl(repoRoot: string): string | null {
  try {
    const config = fs.readFileSync(path.join(repoRoot, ".git", "config"), "utf-8");
    const match = config.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Short SHA of HEAD, or undefined when not a git repo / empty. */
export function gitShortHead(repoRoot: string): string | undefined {
  return git(repoRoot, ["rev-parse", "--short", "HEAD"]);
}

/** Short SHA for a ref (e.g. `origin/main`), or undefined. */
export function gitShortRef(repoRoot: string, ref: string): string | undefined {
  return git(repoRoot, ["rev-parse", "--short", ref]);
}

/** Fetch a branch from origin; updates remote refs only (does not touch the working tree). */
export async function gitFetchOriginBranch(repoRoot: string, branch: string): Promise<void> {
  const result = await runGitRepoAsync(repoRoot, ["fetch", "origin", branch, "--quiet"]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git fetch failed");
  }
}

/** Extract a subtree from a git tree into `extractRoot` via `git archive | tar`. */
export function gitExtractSubtreeArchive(
  repoRoot: string,
  treeRef: string,
  subtreePath: string,
  extractRoot: string,
): void {
  fs.mkdirSync(extractRoot, { recursive: true });
  const archive = spawnSync("git", ["-C", repoRoot, "archive", treeRef, subtreePath], {
    env: gitEnv(),
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    throw new Error(archive.stderr?.toString().trim() || "git archive failed");
  }
  const tar = spawnSync("tar", ["-x", "-C", extractRoot], {
    input: archive.stdout,
    encoding: "buffer",
  });
  if (tar.status !== 0) {
    throw new Error(tar.stderr?.toString().trim() || "tar extract failed");
  }
}
