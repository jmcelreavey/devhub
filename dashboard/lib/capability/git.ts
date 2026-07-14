import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run `git -C <repoPath> <args>` and return trimmed stdout, or "" on any
 * failure (missing repo, non-zero exit, timeout). Read-only helper used across
 * the capability scanners/explainers.
 */
export async function gitLog(repoPath: string, args: string[], timeoutMs = 6_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], { timeout: timeoutMs });
    return stdout.trim();
  } catch {
    return "";
  }
}
