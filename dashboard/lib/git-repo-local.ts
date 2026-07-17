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

interface GitRepoRunOptions {
  useGhCredentials?: boolean;
  timeout?: number;
  maxBuffer?: number;
}

export function gitEnv(): NodeJS.ProcessEnv {
  return augmentedPathEnv({ GIT_TERMINAL_PROMPT: "0" });
}

/** Git commands that talk to remotes and need GitHub CLI credential helper in the dashboard server. */
export function isGitNetworkCommand(args: string[]): boolean {
  const cmd = args[0];
  return cmd === "fetch" || cmd === "pull" || cmd === "push";
}

/** Default cap for fetch/pull/push so a hung credential helper or network never stalls the API forever. */
export const GIT_NETWORK_TIMEOUT_MS = 300_000;
export const GIT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

function outputLimitError(args: string[], maxBuffer: number): string {
  return `git ${args[0] ?? "command"} output exceeded the ${maxBuffer}-byte limit.`;
}

function isOutputLimitError(error: { code?: string | number; message?: string }): boolean {
  return (
    error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    error.code === "ENOBUFS" ||
    /maxBuffer|ENOBUFS/i.test(error.message ?? "")
  );
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
  opts?: GitRepoRunOptions,
): GitRepoRunResult {
  const useGh = opts?.useGhCredentials ?? isGitNetworkCommand(args);
  const maxBuffer = opts?.maxBuffer ?? GIT_MAX_BUFFER_BYTES;
  const r = spawnSync("git", gitArgsForRepo(repoRoot, args, useGh), {
    encoding: "utf-8",
    env: gitEnv(),
    maxBuffer,
  });
  const processError = r.error
    ? isOutputLimitError(r.error)
      ? outputLimitError(args, maxBuffer)
      : r.error.message
    : "";
  return {
    stdout: r.stdout ?? "",
    stderr: processError || r.stderr,
    status: r.error ? 1 : r.status,
  };
}

export async function runGitRepoAsync(
  repoRoot: string,
  args: string[],
  opts?: GitRepoRunOptions,
): Promise<GitRepoRunResult> {
  const useGh = opts?.useGhCredentials ?? isGitNetworkCommand(args);
  const timeout =
    opts?.timeout ?? (isGitNetworkCommand(args) ? GIT_NETWORK_TIMEOUT_MS : undefined);
  const maxBuffer = opts?.maxBuffer ?? GIT_MAX_BUFFER_BYTES;
  try {
    const { stdout, stderr } = await execFileAsync("git", gitArgsForRepo(repoRoot, args, useGh), {
      encoding: "utf-8",
      env: gitEnv(),
      maxBuffer,
      timeout,
    });
    return { stdout, stderr, status: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: NodeJS.Signals | string;
      message?: string;
    };
    const timedOut =
      typeof timeout === "number" && (e.killed || e.signal === "SIGTERM");
    const outputExceeded = isOutputLimitError(e);
    const cmd = args[0] ?? "git";
    return {
      stdout: e.stdout ?? "",
      stderr: outputExceeded
        ? outputLimitError(args, maxBuffer)
        : timedOut
          ? `git ${cmd} timed out after ${Math.round(timeout / 1000)}s — check network, auth, or a stuck hook.`
          : (e.stderr ?? e.message ?? ""),
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
