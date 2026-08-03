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

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "x";
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

  const target = path.join(CACHE_ROOT, safeSegment(repoName), safeSegment(shortHash), filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // stdout is already utf8-decoded, so a binary blob lands here with replacement
  // characters. Acceptable: this cache exists so an editor can show a historical
  // *text* revision, and binaries aren't meaningfully viewable either way.
  fs.writeFileSync(target, blob.stdout ?? "", { encoding: "utf8" });
  return { absolutePath: target, shortHash };
}
