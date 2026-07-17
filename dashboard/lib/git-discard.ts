/**
 * Scoped discard for the repo Git workspace.
 *
 * Critical: discarding *staged* must not wipe unstaged worktree hunks.
 * The old API used `git restore --worktree --staged`, which resets both.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGitRepoAsync, type GitRepoRunResult } from "./git-repo-local";
import { parsePorcelainStatus } from "./repo-git-parsers";

export type DiscardScope = "staged" | "unstaged";

export interface DiscardResult {
  ok: boolean;
  error?: string;
}

interface PathStatus {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
  untracked: boolean;
  staged: boolean;
  unstaged: boolean;
}

function fail(result: GitRepoRunResult, fallback: string): DiscardResult {
  return {
    ok: false,
    error: result.stderr.trim() || result.stdout.trim() || fallback,
  };
}

async function porcelainForPath(repoRoot: string, filePath: string): Promise<PathStatus | null> {
  const status = await runGitRepoAsync(repoRoot, ["status", "--porcelain=v1", "-z"]);
  if (status.status !== 0) return null;
  const file = parsePorcelainStatus(status.stdout || "").find(
    (entry) => entry.path === filePath || entry.originalPath === filePath,
  );
  if (!file) return null;
  return {
    path: file.path,
    ...(file.originalPath ? { originalPath: file.originalPath } : {}),
    index: file.indexStatus,
    worktree: file.worktreeStatus,
    untracked: file.untracked,
    staged: file.staged,
    unstaged: file.unstaged,
  };
}

function isUnmerged(st: PathStatus): boolean {
  return st.index === "U" || st.worktree === "U" || ["AA", "DD"].includes(`${st.index}${st.worktree}`);
}

async function pathInHead(repoRoot: string, filePath: string): Promise<boolean> {
  const out = await runGitRepoAsync(repoRoot, ["cat-file", "-e", `HEAD:${filePath}`]);
  return out.status === 0;
}

async function blobToTemp(repoRoot: string, spec: string | null, label: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `devhub-discard-${label}-${process.pid}-${Date.now()}`);
  if (spec === null) {
    fs.writeFileSync(tmp, "");
    return tmp;
  }
  const out = await runGitRepoAsync(repoRoot, ["show", spec]);
  if (out.status !== 0) {
    fs.writeFileSync(tmp, "");
    return tmp;
  }
  fs.writeFileSync(tmp, out.stdout ?? "");
  return tmp;
}

async function indexFileMode(repoRoot: string, filePath: string): Promise<string | null> {
  const out = await runGitRepoAsync(repoRoot, ["ls-files", "--stage", "-z", "--", filePath]);
  if (out.status !== 0) return null;
  return out.stdout.match(/^(\d{6}) /)?.[1] ?? null;
}

function cleanupTemps(paths: string[]) {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      // best-effort
    }
  }
}

/**
 * Discard staged changes while preserving unstaged worktree deltas.
 * Text files: merge-file of HEAD ← index ← worktree, then reset index+WT and write result.
 * New files (A/AM): remove from index; keep worktree (becomes untracked) when unstaged edits exist.
 */
async function discardStagedKeepUnstaged(repoRoot: string, st: PathStatus): Promise<DiscardResult> {
  const filePath = st.path;
  const headPath = st.originalPath ?? filePath;
  const abs = path.join(repoRoot, filePath);
  const outputAbs = path.join(repoRoot, headPath);
  const inHead = await pathInHead(repoRoot, headPath);
  const temps: string[] = [];

  try {
    if (!inHead) {
      // Added file with further unstaged edits — keep WT, drop from index.
      const rm = await runGitRepoAsync(repoRoot, ["rm", "--cached", "-f", "--", filePath]);
      if (rm.status !== 0) return fail(rm, "Discard staged failed");
      return { ok: true };
    }

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(abs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Preserve an unstaged deletion while resetting the index to HEAD.
      const restore = await runGitRepoAsync(repoRoot, [
        "restore", "--staged", "--", headPath, filePath,
      ]);
      if (restore.status !== 0) return fail(restore, "Discard staged failed");
      return { ok: true };
    }

    const mode = await indexFileMode(repoRoot, filePath);
    if (!stat.isFile() || (mode !== "100644" && mode !== "100755")) {
      return { ok: false, error: "Cannot safely preserve unstaged changes for this file type" };
    }
    const worktreeMode = stat.mode & 0o777;
    const preserveWorktreeMode = Boolean(worktreeMode & 0o111) !== (mode === "100755");

    const headFile = await blobToTemp(repoRoot, `HEAD:${headPath}`, "head");
    const indexFile = await blobToTemp(repoRoot, `:${filePath}`, "index");
    const wtFile = path.join(os.tmpdir(), `devhub-discard-wt-${process.pid}-${Date.now()}`);
    fs.copyFileSync(abs, wtFile);
    const resultFile = path.join(os.tmpdir(), `devhub-discard-out-${process.pid}-${Date.now()}`);
    fs.copyFileSync(headFile, resultFile);
    temps.push(headFile, indexFile, wtFile, resultFile);

    // result = HEAD + (index → worktree). Exit ≥1 usually means conflicts.
    const mergeInPlace = await runGitRepoAsync(repoRoot, [
      "merge-file",
      resultFile,
      indexFile,
      wtFile,
    ]);

    const merged = fs.readFileSync(resultFile, "utf-8");
    if (mergeInPlace.status !== 0 || /^<<<<<<< /m.test(merged) || /^>>>>>>> /m.test(merged)) {
      return fail(mergeInPlace, "Discard staged failed");
    }

    const restore = await runGitRepoAsync(repoRoot, [
      "restore", "--source=HEAD", "--staged", "--worktree", "--", headPath, filePath,
    ]);
    if (restore.status !== 0) return fail(restore, "Discard staged failed");

    fs.writeFileSync(outputAbs, merged);
    if (preserveWorktreeMode) fs.chmodSync(outputAbs, worktreeMode);
    return { ok: true };
  } finally {
    cleanupTemps(temps);
  }
}

async function discardStagedOnly(repoRoot: string, filePath: string): Promise<DiscardResult> {
  const st = await porcelainForPath(repoRoot, filePath);
  if (!st || !st.staged) return { ok: true };

  if (isUnmerged(st)) {
    return { ok: false, error: "Resolve the conflict before discarding staged changes" };
  }

  if (st.unstaged) {
    return discardStagedKeepUnstaged(repoRoot, st);
  }

  if (st.originalPath && (st.index === "R" || st.index === "C")) {
    const restore = await runGitRepoAsync(repoRoot, [
      "restore", "--source=HEAD", "--staged", "--worktree", "--", st.originalPath, st.path,
    ]);
    if (restore.status !== 0) return fail(restore, "Discard staged failed");
    return { ok: true };
  }

  // Staged only — wipe index + worktree back to HEAD (or remove added files).
  if (st.index === "A" || st.index === "?") {
    const rm = await runGitRepoAsync(repoRoot, ["rm", "-f", "--", st.path]);
    if (rm.status !== 0) {
      // Not in index as expected — try clean
      const clean = await runGitRepoAsync(repoRoot, ["clean", "-f", "--", st.path]);
      if (clean.status !== 0) return fail(rm, "Discard staged failed");
    }
    return { ok: true };
  }

  if (st.index === "D") {
    const restore = await runGitRepoAsync(repoRoot, [
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      filePath,
    ]);
    if (restore.status !== 0) return fail(restore, "Discard staged failed");
    return { ok: true };
  }

  const restore = await runGitRepoAsync(repoRoot, [
    "restore",
    "--source=HEAD",
    "--staged",
    "--worktree",
    "--",
    filePath,
  ]);
  if (restore.status !== 0) {
    const fallback = await runGitRepoAsync(repoRoot, ["checkout", "HEAD", "--", filePath]);
    if (fallback.status !== 0) return fail(restore, "Discard staged failed");
  }
  return { ok: true };
}

async function discardUnstagedOnly(repoRoot: string, filePath: string): Promise<DiscardResult> {
  const st = await porcelainForPath(repoRoot, filePath);
  if (!st) return { ok: true };

  if (st.untracked) {
    const clean = await runGitRepoAsync(repoRoot, ["clean", "-f", "--", filePath]);
    if (clean.status !== 0) return fail(clean, "Discard failed");
    return { ok: true };
  }

  if (!st.unstaged) return { ok: true };

  // Restore worktree to index — keeps staged hunks, drops unstaged.
  const restore = await runGitRepoAsync(repoRoot, ["restore", "--worktree", "--", filePath]);
  if (restore.status !== 0) {
    const fallback = await runGitRepoAsync(repoRoot, ["checkout", "--", filePath]);
    if (fallback.status !== 0) return fail(restore, "Discard failed");
  }
  return { ok: true };
}

/** Discard one or more paths with staged-vs-unstaged semantics. */
export async function discardGitPaths(
  repoRoot: string,
  paths: string[],
  scope: DiscardScope,
): Promise<DiscardResult> {
  for (const filePath of paths) {
    if (!filePath || filePath.includes("..") || filePath.startsWith("/")) {
      return { ok: false, error: "Invalid path" };
    }
    const result =
      scope === "staged"
        ? await discardStagedOnly(repoRoot, filePath)
        : await discardUnstagedOnly(repoRoot, filePath);
    if (!result.ok) return result;
  }
  return { ok: true };
}
