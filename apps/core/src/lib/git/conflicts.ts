import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONTENT_SYNC_PATHS } from "../content/sync-paths";
import { runGitRepoAsync } from "./repo-local";

export type GitConflictSource = "unmerged" | "markers";

export interface GitConflictFile {
  path: string;
  source: GitConflictSource;
  status?: string;
}

export interface GitConflictSides {
  base: string | null;
  ours: string | null;
  theirs: string | null;
  binary: boolean;
}

export type GitConflictOperation = "merge" | "cherry-pick" | "revert" | "rebase";

const UNMERGED_XY = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);
const MARKER_START = /^<<<<<<< /m;

function isSafeConflictPath(repoRoot: string, filePath: string): boolean {
  if (filePath.includes("..") || path.isAbsolute(filePath)) return false;
  const root = fs.realpathSync(repoRoot);
  let current = root;
  for (const component of path.normalize(filePath).split(path.sep)) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) return true;
    if (stat.isSymbolicLink()) return false;
    const relative = path.relative(root, fs.realpathSync(current));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  }
  return true;
}

function verifyConflictFd(repoRoot: string, filePath: string, root: string, fd: number): void {
  const abs = path.join(repoRoot, filePath);
  if (fs.realpathSync(repoRoot) !== root || !isSafeConflictPath(repoRoot, filePath)) throw new Error("Invalid path");
  const relative = path.relative(root, fs.realpathSync(path.dirname(abs)));
  const opened = fs.fstatSync(fd);
  const current = fs.lstatSync(abs);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) {
    throw new Error("Invalid path");
  }
}

function openConflictFile(repoRoot: string, filePath: string, flags: number): { fd: number; root: string } {
  const root = fs.realpathSync(repoRoot);
  if (!isSafeConflictPath(repoRoot, filePath)) throw new Error("Invalid path");
  const fd = fs.openSync(path.join(repoRoot, filePath), flags | fs.constants.O_NOFOLLOW, 0o666);
  try {
    verifyConflictFd(repoRoot, filePath, root, fd);
    return { fd, root };
  } catch (error) {
    if (flags & fs.constants.O_CREAT) removeCreatedFile(root, path.join(repoRoot, filePath), fd);
    fs.closeSync(fd);
    throw error;
  }
}

// O_EXCL means this call created the file. If a swapped parent put it outside the
// repo, remove it while the path still points at the same, still-empty inode.
function removeCreatedFile(root: string, abs: string, fd: number): void {
  try {
    const parent = fs.realpathSync(path.dirname(abs));
    const relative = path.relative(root, parent);
    // A canonical parent inside the repo can still be swapped for an outside symlink.
    if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return;
    const createdPath = path.join(parent, path.basename(abs));
    const opened = fs.fstatSync(fd);
    const current = fs.lstatSync(createdPath);
    if (current.isFile() && current.dev === opened.dev && current.ino === opened.ino && opened.size === 0) fs.unlinkSync(createdPath);
  } catch {
    // Best effort: the original verification error is what the caller needs.
  }
}

// Read-only files get the owner write bit through a verified descriptor for the
// save; the caller restores restoreMode afterwards.
function openExistingForWrite(repoRoot: string, filePath: string): { fd: number; root: string; restoreMode?: number } {
  try {
    return openConflictFile(repoRoot, filePath, fs.constants.O_RDWR);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw error;
  }
  const readOnly = openConflictFile(repoRoot, filePath, fs.constants.O_RDONLY);
  try {
    const before = fs.fstatSync(readOnly.fd);
    if (before.nlink !== 1) throw new Error("Invalid path");
    const mode = before.mode & 0o7777;
    if (mode & 0o200) throw new Error("Permission denied: DevHub cannot write this file.");
    fs.fchmodSync(readOnly.fd, mode | 0o200);
    try {
      const opened = openConflictFile(repoRoot, filePath, fs.constants.O_RDWR);
      const after = fs.fstatSync(opened.fd);
      if (after.dev !== before.dev || after.ino !== before.ino) {
        fs.closeSync(opened.fd);
        throw new Error("Invalid path");
      }
      return { ...opened, restoreMode: mode };
    } catch (error) {
      fs.fchmodSync(readOnly.fd, mode);
      throw error;
    }
  } finally {
    fs.closeSync(readOnly.fd);
  }
}

function readFileNoFollow(repoRoot: string, filePath: string): string {
  const { fd } = openConflictFile(repoRoot, filePath, fs.constants.O_RDONLY);
  try {
    return fs.readFileSync(fd, "utf-8");
  } finally {
    fs.closeSync(fd);
  }
}

function writeConflictFd(fd: number, bytes: Buffer): void {
  let written = 0;
  while (written < bytes.length) {
    const count = fs.writeSync(fd, bytes, written, bytes.length - written, written);
    if (count === 0) throw new Error("Could not write conflict file");
    written += count;
  }
  fs.ftruncateSync(fd, bytes.length);
  fs.fsyncSync(fd);
}

function writeConflictWithRecovery(fd: number, bytes: Buffer, original: Buffer): void {
  // Keep a durable copy outside the mutable repo path; rollback uses the verified
  // descriptor so restoring after an error cannot follow a swapped symlink.
  const recoveryDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-conflict-recovery-"));
  const recoveryPath = path.join(recoveryDir, "original");
  let keepRecovery = false;
  try {
    fs.writeFileSync(recoveryPath, original, { flag: "wx", mode: 0o600, flush: true });
    try {
      writeConflictFd(fd, bytes);
    } catch (error) {
      try {
        writeConflictFd(fd, original);
      } catch (restoreError) {
        keepRecovery = true;
        throw new AggregateError([error, restoreError], `Save and rollback failed. Original content preserved at ${recoveryPath}`);
      }
      throw error;
    }
  } finally {
    if (!keepRecovery) fs.rmSync(recoveryDir, { recursive: true, force: true });
  }
}

function isUnmergedPorcelainLine(line: string): boolean {
  if (line.length < 4) return false;
  const xy = line.slice(0, 2);
  return UNMERGED_XY.has(xy) || xy.includes("U");
}

function parseUnmergedFiles(output: string): GitConflictFile[] {
  const conflicts: GitConflictFile[] = [];
  for (const line of output.trim().split("\n").filter(Boolean)) {
    if (!isUnmergedPorcelainLine(line)) continue;
    const filePath = line.slice(3).trim();
    if (!filePath) continue;
    conflicts.push({ path: filePath, source: "unmerged", status: line.slice(0, 2) });
  }
  return conflicts;
}

export async function detectUnmergedFiles(repoRoot: string): Promise<GitConflictFile[]> {
  const status = await runGitRepoAsync(repoRoot, ["status", "--porcelain=v1"], { env: { GIT_OPTIONAL_LOCKS: "0" } });
  return status.status === 0 ? parseUnmergedFiles(status.stdout) : [];
}

function walkForMarkerConflicts(dir: string, repoRoot: string, found: Map<string, GitConflictFile>): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkForMarkerConflicts(full, repoRoot, found);
      continue;
    }
    try {
      const rel = path.relative(repoRoot, full).replace(/\\/g, "/");
      const raw = readFileNoFollow(repoRoot, rel);
      if (!MARKER_START.test(raw)) continue;
      if (!found.has(rel)) found.set(rel, { path: rel, source: "markers" });
    } catch {
      // skip unreadable
    }
  }
}

export function detectMarkerConflicts(repoRoot: string): GitConflictFile[] {
  const found = new Map<string, GitConflictFile>();
  for (const prefix of CONTENT_SYNC_PATHS) {
    if (!fs.existsSync(path.join(repoRoot, prefix)) || !isSafeConflictPath(repoRoot, prefix)) continue;
    walkForMarkerConflicts(path.join(repoRoot, prefix), repoRoot, found);
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function mergeConflicts(markers: GitConflictFile[], unmerged: GitConflictFile[]): GitConflictFile[] {
  const byPath = new Map<string, GitConflictFile>();
  for (const conflict of markers) byPath.set(conflict.path, conflict);
  for (const conflict of unmerged) byPath.set(conflict.path, conflict);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function detectGitConflictsAsync(repoRoot: string): Promise<GitConflictFile[]> {
  const markers = detectMarkerConflicts(repoRoot);
  return mergeConflicts(markers, await detectUnmergedFiles(repoRoot));
}

export function readConflictFileContent(repoRoot: string, filePath: string): string | null {
  try {
    return readFileNoFollow(repoRoot, filePath);
  } catch {
    return null;
  }
}

async function readConflictStage(repoRoot: string, filePath: string, stage: 1 | 2 | 3): Promise<string | null> {
  const result = await runGitRepoAsync(repoRoot, ["show", `:${stage}:${filePath}`]);
  return result.status === 0 ? result.stdout : null;
}

export async function readConflictSides(repoRoot: string, filePath: string): Promise<GitConflictSides> {
  const [base, ours, theirs] = await Promise.all([
    readConflictStage(repoRoot, filePath, 1),
    readConflictStage(repoRoot, filePath, 2),
    readConflictStage(repoRoot, filePath, 3),
  ]);
  return {
    base,
    ours,
    theirs,
    binary: [base, ours, theirs].some((content) => content?.includes("\0")),
  };
}

export async function detectConflictOperation(repoRoot: string): Promise<GitConflictOperation | null> {
  const gitPath = async (name: string) => {
    const result = await runGitRepoAsync(repoRoot, ["rev-parse", "--git-path", name]);
    const value = result.status === 0 ? result.stdout.trim() : "";
    return value && !path.isAbsolute(value) ? path.join(repoRoot, value) : value;
  };
  if (fs.existsSync(await gitPath("CHERRY_PICK_HEAD"))) return "cherry-pick";
  if (fs.existsSync(await gitPath("REVERT_HEAD"))) return "revert";
  if (fs.existsSync(await gitPath("rebase-merge")) || fs.existsSync(await gitPath("rebase-apply"))) return "rebase";
  if (fs.existsSync(await gitPath("MERGE_HEAD"))) return "merge";
  return null;
}

export async function resolveConflictFile(
  repoRoot: string,
  filePath: string,
  content: string,
  expectedContent: string | null,
): Promise<{ ok: true } | { ok: false; error: string; code?: "content_changed" }> {
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return { ok: false, error: "Invalid path" };
  }
  if (MARKER_START.test(content)) {
    return { ok: false, error: "Content still contains conflict markers — resolve them before saving." };
  }

  const changed = { ok: false, code: "content_changed", error: "File changed on disk. Copy your draft, refresh, and select the file again." } as const;
  let fd: number | undefined;
  let restoreMode: number | undefined;
  const closeFd = () => {
    if (fd === undefined) return;
    const closing = fd;
    fd = undefined;
    try {
      if (restoreMode !== undefined) fs.fchmodSync(closing, restoreMode);
    } finally {
      fs.closeSync(closing);
    }
  };
  try {
    if (expectedContent === null) {
      if (!isSafeConflictPath(repoRoot, filePath)) return { ok: false, error: "Invalid path" };
      fs.mkdirSync(path.dirname(path.join(repoRoot, filePath)), { recursive: true });
    }
    const opened: { fd: number; root: string; restoreMode?: number } = expectedContent === null
      ? openConflictFile(repoRoot, filePath, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL)
      : openExistingForWrite(repoRoot, filePath);
    fd = opened.fd;
    restoreMode = opened.restoreMode;
    const original = expectedContent === null ? null : fs.readFileSync(fd);
    if (original !== null && original.toString("utf-8") !== expectedContent) {
      closeFd();
      return changed;
    }
    verifyConflictFd(repoRoot, filePath, opened.root, fd);
    if (fs.fstatSync(fd).nlink !== 1) {
      closeFd();
      return { ok: false, error: "Invalid path" };
    }
    const bytes = Buffer.from(content, "utf-8");
    if (original === null) writeConflictFd(fd, bytes);
    else writeConflictWithRecovery(fd, bytes, original);
    closeFd();
    const add = await runGitRepoAsync(repoRoot, ["add", "--", filePath]);
    if (add.status !== 0) {
      return { ok: false, error: add.stderr.trim() || "git add failed" };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      closeFd();
    } catch (closeError) {
      // Keep the recovery location visible if restoring permissions also fails.
      return { ok: false, error: `${message}; File mode restoration failed: ${closeError instanceof Error ? closeError.message : String(closeError)}` };
    }
    if ((e as NodeJS.ErrnoException).code === "ENOENT" && expectedContent !== null) return changed;
    if ((e as NodeJS.ErrnoException).code === "EEXIST" && expectedContent === null) return changed;
    return { ok: false, error: message };
  }
}

export async function deleteConflictFile(
  repoRoot: string,
  filePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return { ok: false, error: "Invalid path" };
  }
  const remove = await runGitRepoAsync(repoRoot, ["rm", "--", filePath]);
  return remove.status === 0
    ? { ok: true }
    : { ok: false, error: remove.stderr.trim() || "git rm failed" };
}

export async function resolveConflictSide(
  repoRoot: string,
  filePath: string,
  side: "base" | "ours" | "theirs",
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return { ok: false, error: "Invalid path" };
  }
  const stage = side === "base" ? 1 : side === "ours" ? 2 : 3;
  const sides = await readConflictSides(repoRoot, filePath);
  if (sides[side] === null) return deleteConflictFile(repoRoot, filePath);
  const checkout = await runGitRepoAsync(repoRoot, ["checkout-index", "--force", `--stage=${stage}`, "--", filePath]);
  if (checkout.status !== 0) {
    return { ok: false, error: checkout.stderr.trim() || `Could not take ${side}` };
  }
  const add = await runGitRepoAsync(repoRoot, ["add", "--", filePath]);
  return add.status === 0
    ? { ok: true }
    : { ok: false, error: add.stderr.trim() || "git add failed" };
}
