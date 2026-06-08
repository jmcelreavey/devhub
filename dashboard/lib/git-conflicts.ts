import fs from "node:fs";
import path from "node:path";
import { CONTENT_SYNC_PATHS } from "./content-sync-paths";
import { runGitRepo } from "./git-repo-local";

export type GitConflictSource = "unmerged" | "markers";

export interface GitConflictFile {
  path: string;
  source: GitConflictSource;
  status?: string;
}

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
