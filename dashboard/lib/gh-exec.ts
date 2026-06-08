import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { augmentedPathEnv } from "./process-env";

const execFileAsync = promisify(execFile);

export const GH_AUTH_REQUIRED_MESSAGE =
  "GitHub CLI auth is required. Run `gh auth login` in your terminal.";
export const GH_NOT_FOUND_MESSAGE =
  "GitHub CLI (`gh`) was not found in the dashboard server PATH.";

export type GithubCliErrorKind = "auth" | "missing" | "other";

export interface GithubCliErrorInfo {
  kind: GithubCliErrorKind;
  message: string;
  httpStatus: number;
}

/** PATH augmented with common CLI locations so `gh` resolves when the dashboard server has a minimal PATH. */
export function ghEnv(): NodeJS.ProcessEnv {
  return augmentedPathEnv();
}

const defaultMaxBuffer = 20 * 1024 * 1024;

export async function execGh(
  args: string[],
  opts?: { maxBuffer?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("gh", args, {
    maxBuffer: opts?.maxBuffer ?? defaultMaxBuffer,
    env: ghEnv(),
    cwd: opts?.cwd,
  });
}

export async function execGhJsonLines<T>(args: string[]): Promise<T[]> {
  const { stdout } = await execGh(args);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** For commands like `gh search prs --json` that emit one JSON array (not NDJSON). */
export async function execGhJsonArray<T>(args: string[]): Promise<T[]> {
  const { stdout } = await execGh(args);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed: unknown = JSON.parse(trimmed);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export async function isGithubCliAuthenticated(): Promise<boolean> {
  try {
    await execGh(["auth", "status", "--hostname", "github.com"]);
    return true;
  } catch {
    return false;
  }
}

export function githubCliErrorInfo(
  err: unknown,
  fallback = "GitHub CLI command failed",
): GithubCliErrorInfo {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("spawn gh") || lower.includes("enoent")) {
    return { kind: "missing", message: GH_NOT_FOUND_MESSAGE, httpStatus: 500 };
  }
  if (
    lower.includes("authentication") ||
    lower.includes("requires authentication") ||
    lower.includes("http 401") ||
    lower.includes("not logged in")
  ) {
    return { kind: "auth", message: GH_AUTH_REQUIRED_MESSAGE, httpStatus: 401 };
  }
  const trimmed = message.trim() || fallback;
  return { kind: "other", message: trimmed, httpStatus: 500 };
}

/** Map a thrown `gh` error to an HTTP status + user-facing message (API routes). */
export function mapGithubCliError(
  err: unknown,
  fallback?: string,
): { status: number; error: string } {
  const info = githubCliErrorInfo(err, fallback);
  return { status: info.httpStatus, error: info.message };
}
