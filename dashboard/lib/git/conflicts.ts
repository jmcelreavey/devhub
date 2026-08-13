import fs from "node:fs";
import path from "node:path";
import { CONTENT_SYNC_PATHS } from "@/lib/content/sync-paths";
import { runGitRepo } from "@/lib/git/repo-local";

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

function isUnmergedPorcelainLine(line: string): boolean {
  if (line.length < 4) return false;
  const xy = line.slice(0, 2);
  return UNMERGED_XY.has(xy) || xy.includes("U");
}

export function detectUnmergedFiles(repoRoot: string): GitConflictFile[] {
  const status = runGitRepo(repoRoot, ["status", "--porcelain=v1"]);
  if (status.status !== 0) return [];

  const conflicts: GitConflictFile[] = [];
  for (const line of status.stdout.trim().split("\n").filter(Boolean)) {
    if (!isUnmergedPorcelainLine(line)) continue;
    const filePath = line.slice(3).trim();
    if (!filePath) continue;
    conflicts.push({ path: filePath, source: "unmerged", status: line.slice(0, 2) });
  }
  return conflicts;
}

function walkForMarkerConflicts(dir: string, repoRoot: string, found: Map<string, GitConflictFile>): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkForMarkerConflicts(full, repoRoot, found);
      continue;
    }
    try {
      const raw = fs.readFileSync(full, "utf-8");
      if (!MARKER_START.test(raw)) continue;
      const rel = path.relative(repoRoot, full).replace(/\\/g, "/");
      if (!found.has(rel)) found.set(rel, { path: rel, source: "markers" });
    } catch {
      // skip unreadable
    }
  }
}

export function detectMarkerConflicts(repoRoot: string): GitConflictFile[] {
  const found = new Map<string, GitConflictFile>();
  for (const prefix of CONTENT_SYNC_PATHS) {
    walkForMarkerConflicts(path.join(repoRoot, prefix), repoRoot, found);
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function detectGitConflicts(repoRoot: string): GitConflictFile[] {
  const byPath = new Map<string, GitConflictFile>();
  for (const c of detectMarkerConflicts(repoRoot)) byPath.set(c.path, c);
  for (const c of detectUnmergedFiles(repoRoot)) byPath.set(c.path, c);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function readConflictFileContent(repoRoot: string, filePath: string): string | null {
  const abs = path.join(repoRoot, filePath);
  if (!abs.startsWith(repoRoot) || filePath.includes("..")) return null;
  try {
    return fs.readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}

function readConflictStage(repoRoot: string, filePath: string, stage: 1 | 2 | 3): string | null {
  const result = runGitRepo(repoRoot, ["show", `:${stage}:${filePath}`]);
  return result.status === 0 ? result.stdout : null;
}

export function readConflictSides(repoRoot: string, filePath: string): GitConflictSides {
  const base = readConflictStage(repoRoot, filePath, 1);
  const ours = readConflictStage(repoRoot, filePath, 2);
  const theirs = readConflictStage(repoRoot, filePath, 3);
  return {
    base,
    ours,
    theirs,
    binary: [base, ours, theirs].some((content) => content?.includes("\0")),
  };
}

export function detectConflictOperation(repoRoot: string): GitConflictOperation | null {
  const gitPath = (name: string) => {
    const result = runGitRepo(repoRoot, ["rev-parse", "--git-path", name]);
    const value = result.status === 0 ? result.stdout.trim() : "";
    return value && !path.isAbsolute(value) ? path.join(repoRoot, value) : value;
  };
  if (fs.existsSync(gitPath("CHERRY_PICK_HEAD"))) return "cherry-pick";
  if (fs.existsSync(gitPath("REVERT_HEAD"))) return "revert";
  if (fs.existsSync(gitPath("rebase-merge")) || fs.existsSync(gitPath("rebase-apply"))) return "rebase";
  if (fs.existsSync(gitPath("MERGE_HEAD"))) return "merge";
  return null;
}

export function resolveConflictFile(
  repoRoot: string,
  filePath: string,
  content: string,
): { ok: true } | { ok: false; error: string } {
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return { ok: false, error: "Invalid path" };
  }
  if (MARKER_START.test(content)) {
    return { ok: false, error: "Content still contains conflict markers — resolve them before saving." };
  }

  const abs = path.join(repoRoot, filePath);
  if (!abs.startsWith(repoRoot)) return { ok: false, error: "Invalid path" };

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
    const add = runGitRepo(repoRoot, ["add", "--", filePath]);
    if (add.status !== 0) {
      return { ok: false, error: add.stderr.trim() || "git add failed" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteConflictFile(
  repoRoot: string,
  filePath: string,
): { ok: true } | { ok: false; error: string } {
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return { ok: false, error: "Invalid path" };
  }
  const remove = runGitRepo(repoRoot, ["rm", "--", filePath]);
  return remove.status === 0
    ? { ok: true }
    : { ok: false, error: remove.stderr.trim() || "git rm failed" };
}

export function resolveConflictSide(
  repoRoot: string,
  filePath: string,
  side: "base" | "ours" | "theirs",
): { ok: true } | { ok: false; error: string } {
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return { ok: false, error: "Invalid path" };
  }
  const stage = side === "base" ? 1 : side === "ours" ? 2 : 3;
  const sides = readConflictSides(repoRoot, filePath);
  if (sides[side] === null) return deleteConflictFile(repoRoot, filePath);
  const checkout = runGitRepo(repoRoot, ["checkout-index", "--force", `--stage=${stage}`, "--", filePath]);
  if (checkout.status !== 0) {
    return { ok: false, error: checkout.stderr.trim() || `Could not take ${side}` };
  }
  const add = runGitRepo(repoRoot, ["add", "--", filePath]);
  return add.status === 0
    ? { ok: true }
    : { ok: false, error: add.stderr.trim() || "git add failed" };
}
