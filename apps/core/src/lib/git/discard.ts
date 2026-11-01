/**
 * Scoped discard for the repo Git workspace.
 *
 * Critical: discarding *staged* must not wipe unstaged worktree hunks.
 * The old API used `git restore --worktree --staged`, which resets both.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runGitRepoAsync, type GitRepoRunResult } from "./repo-local";
import { parsePorcelainStatus } from "../../../../../packages/shared/ui-lib/repos/git-parsers";

export type DiscardScope = "staged" | "unstaged";

export interface DiscardResult {
  ok: boolean;
  error?: string;
  conflict?: boolean;
}

const OVERLAP_ERROR = "This file also has unstaged edits that overlap the staged change. Unstage it, or use Discard all.";
const CHANGED_ERROR = "The file changed during discard. Its staged change was unstaged; the working file was left unchanged.";

function overlap(): DiscardResult {
  return { ok: false, conflict: true, error: OVERLAP_ERROR };
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
  if (status.status !== 0) throw new Error(status.stderr.trim() || "Could not read Git status");
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

async function discardStagedOnly(repoRoot: string, filePath: string): Promise<DiscardResult> {
  const st = await porcelainForPath(repoRoot, filePath);
  if (!st || !st.staged) return { ok: true };

  if (isUnmerged(st)) {
    return { ok: false, error: "Resolve the conflict before discarding staged changes" };
  }

  if (st.unstaged) {
    if (st.index !== "M" || st.worktree !== "M") return overlap();
    try {
      return await discardStagedWithUnstaged(repoRoot, st.path);
    } catch {
      return overlap();
    }
  }

  if (st.index === "A") {
    const absolutePath = path.join(repoRoot, st.path);
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() && !stat.isSymbolicLink()) return overlap();
    const before = stat.isSymbolicLink() ? fs.readlinkSync(absolutePath, { encoding: "buffer" }) : fs.readFileSync(absolutePath);
    const unchanged = () => {
      const current = fs.lstatSync(absolutePath);
      if (current.dev !== stat.dev || current.ino !== stat.ino || current.mode !== stat.mode) return false;
      const content = current.isSymbolicLink() ? fs.readlinkSync(absolutePath, { encoding: "buffer" }) : fs.readFileSync(absolutePath);
      return content.equals(before);
    };
    const diff = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "diff", "--quiet", "--", st.path]);
    if (diff.status !== 0 || !unchanged()) return overlap();
    const rm = await runGitRepoAsync(repoRoot, ["update-index", "--force-remove", "--", st.path]);
    if (rm.status !== 0) return fail(rm, "Discard staged failed");
    if (!unchanged()) return { ok: false, conflict: true, error: CHANGED_ERROR };
    fs.unlinkSync(absolutePath);
    return { ok: true };
  }

  const worktreeDiff = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "diff", "--quiet", "--", st.path]);
  if (worktreeDiff.status !== 0) return overlap();
  if ((st.index === "D" && fs.lstatSync(path.join(repoRoot, st.path), { throwIfNoEntry: false })) ||
      (st.index === "R" && st.originalPath && fs.lstatSync(path.join(repoRoot, st.originalPath), { throwIfNoEntry: false }))) {
    return overlap();
  }
  const paths = st.index === "R" && st.originalPath ? [st.originalPath, st.path] : [st.path];
  const worktreePath = path.join(repoRoot, st.path);
  const worktreeStat = fs.lstatSync(worktreePath, { throwIfNoEntry: false });
  if (worktreeStat?.isDirectory()) {
    const index = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", st.path]);
    if (index.status !== 0 || !index.stdout.startsWith("160000 ")) return overlap();
    const top = await runGitRepoAsync(repoRoot, ["-C", worktreePath, "rev-parse", "--show-toplevel"]);
    if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(worktreePath)) return overlap();
    const status = await runGitRepoAsync(repoRoot, ["-C", worktreePath, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored", "--ignore-submodules=none"]);
    if (status.status !== 0 || status.stdout) return overlap();
    const head = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--", st.path]);
    const commit = /^160000 commit ([0-9a-f]+)\t/.exec(head.stdout)?.[1];
    if (head.status !== 0 || !commit) return overlap();
    // A non-forced checkout also protects edits made after the status check.
    const checkout = await runGitRepoAsync(repoRoot, ["-C", worktreePath, "checkout", "--detach", "--no-overwrite-ignore", commit]);
    if (checkout.status !== 0) return overlap();
    const restore = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--", ...paths]);
    if (restore.status !== 0) return fail(restore, "Discard staged failed");
    return { ok: true };
  }

  // --index checks the working file again when applying, so an editor save
  // after the clean check cannot be overwritten by an unconditional restore.
  const diff = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--", ...paths]);
  if (diff.status !== 0) return fail(diff, "Could not read staged changes");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-discard-"));
  try {
    const patch = path.join(tempDir, "staged.patch");
    fs.writeFileSync(patch, diff.stdout);
    const apply = await runGitRepoAsync(repoRoot, ["apply", "--reverse", "--index", "--whitespace=nowarn", patch]);
    return apply.status === 0 ? { ok: true } : overlap();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function discardStagedWithUnstaged(repoRoot: string, filePath: string): Promise<DiscardResult> {
  const absolutePath = path.join(repoRoot, filePath);
  const index = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", filePath]);
  const head = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--", filePath]);
  const indexMode = /^(100644|100755) [0-9a-f]+ 0\t/.exec(index.stdout)?.[1];
  const headMode = /^(100644|100755) blob [0-9a-f]+\t/.exec(head.stdout)?.[1];
  if (index.status !== 0 || head.status !== 0 || !indexMode || !headMode) return overlap();

  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile()) return overlap();
  const original = fs.readFileSync(absolutePath);
  const text = original.toString("utf8");
  if (!Buffer.from(text).equals(original) || text.includes("\0")) return overlap();

  const staged = await runGitRepoAsync(repoRoot, ["cat-file", "--filters", `:${filePath}`]);
  const base = await runGitRepoAsync(repoRoot, ["cat-file", "--filters", `HEAD:${filePath}`]);
  if (staged.status !== 0 || base.status !== 0 ||
      [staged.stdout, base.stdout].some((content) => content.includes("\0") || content.includes("\ufffd"))) {
    return overlap();
  }

  let tempDir: string | null = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-discard-"));
  const replacement = path.join(path.dirname(absolutePath), `.devhub-discard-${randomUUID()}`);
  let replacementCreated = false;
  let indexReset = false;
  try {
    const worktreeFile = path.join(tempDir, "worktree");
    const indexFile = path.join(tempDir, "index");
    const headFile = path.join(tempDir, "head");
    fs.writeFileSync(worktreeFile, original);
    fs.writeFileSync(indexFile, staged.stdout);
    fs.writeFileSync(headFile, base.stdout);
    const merge = await runGitRepoAsync(repoRoot, ["merge-file", "-p", worktreeFile, indexFile, headFile]);
    if (merge.status !== 0) return overlap();

    let mode = stat.mode & 0o777;
    if (((mode & 0o111) !== 0) === (indexMode === "100755")) {
      mode = headMode === "100755" ? mode | ((mode & 0o444) >> 2) : mode & ~0o111;
    }
    const descriptor = fs.openSync(replacement, "wx", mode);
    replacementCreated = true;
    try {
      fs.writeFileSync(descriptor, merge.stdout);
      fs.fchmodSync(descriptor, mode);
    } finally {
      fs.closeSync(descriptor);
    }
    const currentIndex = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", filePath]);
    const currentHead = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--", filePath]);
    if (currentIndex.status !== 0 || currentHead.status !== 0 ||
        currentIndex.stdout !== index.stdout || currentHead.stdout !== head.stdout ||
        !fs.readFileSync(absolutePath).equals(original)) return overlap();

    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    const restore = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "restore", "--staged", "--", filePath]);
    if (restore.status !== 0) return fail(restore, "Discard staged failed");
    indexReset = true;
    const currentStat = fs.lstatSync(absolutePath);
    if (!currentStat.isFile() || currentStat.ino !== stat.ino || currentStat.dev !== stat.dev ||
        currentStat.mode !== stat.mode || !fs.readFileSync(absolutePath).equals(original)) {
      return { ok: false, conflict: true, error: CHANGED_ERROR };
    }
    fs.renameSync(replacement, absolutePath);
    replacementCreated = false;
    return { ok: true };
  } catch (error) {
    return indexReset
      ? { ok: false, error: `The staged change was unstaged, but the working file was not replaced: ${error instanceof Error ? error.message : "Discard failed"}` }
      : overlap();
  } finally {
    if (replacementCreated) fs.rmSync(replacement, { force: true });
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function discardUnstagedOnly(repoRoot: string, filePath: string): Promise<DiscardResult> {
  const st = await porcelainForPath(repoRoot, filePath);
  if (!st) return { ok: true };

  if (st.untracked) {
    // git clean -f refuses directories, so an untracked cache dir looked discardable and then did nothing.
    const rel = filePath.replace(/\/+$/, "");
    let directory = filePath.endsWith("/");
    try {
      directory = fs.statSync(path.join(repoRoot, rel)).isDirectory();
    } catch {
      // Path already gone, or status still has the trailing slash.
    }
    const clean = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "clean", directory ? "-fd" : "-f", "--", rel]);
    if (clean.status !== 0) return fail(clean, "Discard failed");
    return { ok: true };
  }

  if (!st.unstaged) return { ok: true };

  // Restore worktree to index — keeps staged hunks, drops unstaged.
  const restore = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "restore", "--worktree", "--", filePath]);
  if (restore.status !== 0) {
    const fallback = await runGitRepoAsync(repoRoot, ["--literal-pathspecs", "checkout", "--", filePath]);
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
    let result: DiscardResult;
    try {
      result = scope === "staged"
        ? await discardStagedOnly(repoRoot, filePath)
        : await discardUnstagedOnly(repoRoot, filePath);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Discard failed" };
    }
    if (!result.ok) return result;
  }
  return { ok: true };
}
