/**
 * Materialize a git blob (commit:path) into a cache file so desktop editors
 * can open a historical revision alongside the live working tree.
 *
 * Shared by History / Blame "Open with Cursor" so both use one layout.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { isSafeCommitRef, isSafeRepoRelPath } from "@/lib/git/ref-safety";

const CACHE_ROOT = path.join(os.homedir(), ".cache", "devhub", "git-revisions");

/**
 * Revisions older than this are dropped on the next write. A materialized blob
 * is only useful while the editor tab that opened it is still around, so a day
 * is generous — without this the directory grows for the life of the machine.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "x";
}

/**
 * Best-effort sweep of stale `<repo>/<short>` revision directories.
 *
 * Deliberately never throws: a cache we failed to tidy must not break the
 * "open this file at that commit" action the user actually asked for.
 */
export function pruneGitRevisionCache(now = Date.now(), ttlMs = CACHE_TTL_MS): number {
  let removed = 0;
  let repoDirs: string[];
  try {
    repoDirs = fs.readdirSync(CACHE_ROOT);
  } catch {
    return 0; // never created yet
  }
  for (const repoDir of repoDirs) {
    const repoPath = path.join(CACHE_ROOT, repoDir);
    let revisionDirs: string[] = [];
    try {
      revisionDirs = fs.readdirSync(repoPath);
    } catch {
      continue;
    }
    for (const revisionDir of revisionDirs) {
      const revisionPath = path.join(repoPath, revisionDir);
      try {
        if (now - fs.statSync(revisionPath).mtimeMs <= ttlMs) continue;
        fs.rmSync(revisionPath, { recursive: true, force: true });
        removed += 1;
      } catch {
        // locked / vanished mid-sweep — leave it for next time
      }
    }
    // Drop the repo folder once its last revision is gone.
    try {
      if (fs.readdirSync(repoPath).length === 0) fs.rmdirSync(repoPath);
    } catch {
      // non-empty or unreadable — fine
    }
  }
  return removed;
}

export interface MaterializedRevision {
  /** Absolute path to the cached blob contents. */
  absolutePath: string;
  /** Short commit used in the cache layout. */
  shortHash: string;
}

/**
 * Write `commit:filePath` to `~/.cache/devhub/git-revisions/<repo>/<short>/<path>`.
 * Returns null when the blob cannot be read.
 */
export async function materializeGitRevisionFile(
  repoRoot: string,
  repoName: string,
  commit: string,
  filePath: string,
): Promise<MaterializedRevision | { error: string }> {
  if (!isSafeCommitRef(commit)) return { error: "Invalid commit" };
  if (!isSafeRepoRelPath(filePath)) return { error: "Invalid path" };

  const short = await runGitRepoAsync(repoRoot, ["rev-parse", "--short", commit]);
  if (short.status !== 0) return { error: "Commit not found" };
  const shortHash = (short.stdout || "").trim() || commit.slice(0, 7);

  const blob = await runGitRepoAsync(repoRoot, ["show", `${commit}:${filePath}`]);
  if (blob.status !== 0) {
    return { error: (blob.stderr || "").trim() || "Could not read file at that revision" };
  }

  pruneGitRevisionCache();

  const target = path.join(CACHE_ROOT, safeSegment(repoName), safeSegment(shortHash), filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // stdout is already utf8-decoded, so a binary blob lands here with replacement
  // characters. Acceptable: this cache exists so an editor can show a historical
  // *text* revision, and binaries aren't meaningfully viewable either way.
  fs.writeFileSync(target, blob.stdout ?? "", { encoding: "utf8" });
  return { absolutePath: target, shortHash };
}
