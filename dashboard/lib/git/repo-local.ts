import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { augmentedPathEnv, scrubDesktopRuntimeEnv } from "@/lib/process-env";

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
  return scrubDesktopRuntimeEnv(augmentedPathEnv({ GIT_TERMINAL_PROMPT: "0" }));
}

/** Git commands that talk to remotes and need GitHub CLI credential helper in the dashboard server. */
export function isGitNetworkCommand(args: string[]): boolean {
  const cmd = args[0];
  return cmd === "fetch" || cmd === "pull" || cmd === "push";
}

/** Default cap for fetch/pull/push so a hung credential helper or network never stalls the API forever. */
export const GIT_NETWORK_TIMEOUT_MS = 600_000;
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
  return readRemoteUrl(repoRoot, "origin");
}

/**
 * Directory holding the config for this checkout.
 *
 * `<repo>/.git` for a clone. For a worktree, `.git` is a file naming a gitdir
 * under the main repository's `.git/worktrees/`, and the config it shares lives
 * in the common dir that `commondir` points at.
 */
function resolveConfigDir(repoRoot: string): string {
  const dotGit = path.join(repoRoot, ".git");
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf-8").trim());
    if (!pointer?.[1]) return dotGit;
    const gitDir = path.isAbsolute(pointer[1].trim())
      ? pointer[1].trim()
      : path.resolve(repoRoot, pointer[1].trim());
    const commonPath = path.join(gitDir, "commondir");
    if (!fs.existsSync(commonPath)) return gitDir;
    const common = fs.readFileSync(commonPath, "utf-8").trim();
    return path.isAbsolute(common) ? common : path.resolve(gitDir, common);
  } catch {
    return dotGit;
  }
}

/**
 * A named remote's URL from `.git/config`, or null.
 *
 * Reads the config rather than shelling out because callers are synchronous and
 * on the render path. The section match is anchored to the next `[` so a remote
 * whose block has no `url` cannot pick up the URL of the one after it.
 */
export function readRemoteUrl(repoRoot: string, remote: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) return null;
  try {
    // `.git` is a file in a worktree, pointing at a gitdir that shares the main
    // repository's config — so the path has to be resolved rather than assumed.
    const config = fs.readFileSync(path.join(resolveConfigDir(repoRoot), "config"), "utf-8");
    const section = new RegExp(
      `\\[remote "${remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\]([^[]*)`,
    ).exec(config);
    const url = section?.[1] ? /^\s*url\s*=\s*(.+)$/m.exec(section[1]) : null;
    return url?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Browsable https URL for an origin remote, or null.
 *
 * Handles the three shapes a remote actually takes in the wild — scp-style
 * `git@host:owner/repo.git`, `ssh://git@host/owner/repo.git`, and plain https —
 * so "Open on GitHub" works regardless of how the repo was cloned.
 */
export function remoteWebUrl(remote: string | null): string | null {
  if (!remote) return null;
  const trimmed = remote.trim().replace(/\.git$/, "");
  const scp = trimmed.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = trimmed.match(/^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  if (/^https?:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.protocol = "https:";
      url.username = "";
      url.password = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  }
  return null;
}

/** Short SHA of HEAD, or undefined when not a git repo / empty. */
export function gitShortHead(repoRoot: string): string | undefined {
  return git(repoRoot, ["rev-parse", "--short", "HEAD"]);
}

/** Short SHA for a ref (e.g. `origin/main`), or undefined. */
export function gitShortRef(repoRoot: string, ref: string): string | undefined {
  return git(repoRoot, ["rev-parse", "--short", ref]);
}

/** Resolve origin's default branch tip (origin/main or origin/master). */
export async function resolveDefaultRemoteBranch(repoRoot: string): Promise<string | null> {
  const symbolic = await runGitRepoAsync(repoRoot, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  const ref = symbolic.stdout.trim();
  if (symbolic.status === 0 && ref.startsWith("origin/")) return ref;
  for (const candidate of ["origin/main", "origin/master"] as const) {
    if ((await runGitRepoAsync(repoRoot, ["rev-parse", "--verify", "--quiet", candidate])).status === 0) {
      return candidate;
    }
  }
  return null;
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
