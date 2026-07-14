/**
 * Capability Radar — personal exposure.
 *
 * "When did *I* last touch the files behind this signal?" Drives drift: a
 * technology spreading across repos while your hands-on contact goes stale is
 * exactly what the radar should surface.
 *
 * Identity = git author emails. Resolved from (in order): the
 * CAPABILITY_AUTHOR_EMAILS env var (comma-separated), then `git config
 * user.email` of the scanned repo. `git log --author` treats each value as a
 * regex OR, so multiple identities are supported.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 6_000;
/** Cap evidence paths handed to `git log` so the argv stays sane. */
const MAX_PATHSPEC = 20;

function envEmails(): string[] {
  return (process.env.CAPABILITY_AUTHOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const configEmailCache = new Map<string, string[]>();

async function repoAuthorEmails(repoPath: string): Promise<string[]> {
  const cached = configEmailCache.get(repoPath);
  if (cached) return cached;
  let emails: string[] = [];
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "config", "user.email"], {
      timeout: GIT_TIMEOUT_MS,
    });
    const email = stdout.trim();
    if (email) emails = [email];
  } catch {
    emails = [];
  }
  configEmailCache.set(repoPath, emails);
  return emails;
}

/** All author identities that count as "me" for this repo. */
export async function resolveAuthorEmails(repoPath: string): Promise<string[]> {
  const env = envEmails();
  if (env.length > 0) return env;
  return repoAuthorEmails(repoPath);
}

/**
 * ISO date I last authored a commit touching any of `paths`, or null if never
 * (or on error / no identity). Escapes regex metachars in emails so `.` in an
 * address isn't treated as a wildcard.
 */
export async function lastTouchedByMe(
  repoPath: string,
  paths: string[],
  emails: string[],
): Promise<string | null> {
  if (emails.length === 0 || paths.length === 0) return null;
  const authorArgs = emails.flatMap((e) => ["--author", escapeRegex(e)]);
  const pathspec = paths.slice(0, MAX_PATHSPEC);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "log", "-1", "--all-match", "--format=%cI", ...authorArgs, "--", ...pathspec],
      { timeout: GIT_TIMEOUT_MS },
    );
    const iso = stdout.trim().split("\n")[0]?.trim();
    return iso || null;
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole days between an ISO date and now; null passes through. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
