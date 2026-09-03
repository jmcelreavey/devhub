/**
 * Finding SQLite files in the repos you already have checked out.
 *
 * The reason `/db` is useful on a machine with no AWS profile and no VPN: a
 * React Native app's local cache, a fixture database, a `dev.db` from a Prisma
 * project. All things you currently open a separate app for, and all already
 * sitting in the repo scan directory.
 *
 * Cheap by construction — a bounded walk that skips the directories that make
 * a naive scan take minutes. This runs from the "Add connection" panel, not on
 * every page load.
 */

import fs from "node:fs";
import path from "node:path";
import { getReposScanDir } from "@/lib/repos";

/** Extensions SQLite files conventionally use. */
const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3", ".db3"]);

/**
 * Directories never worth walking.
 *
 * `node_modules` is the one that matters — it can hold tens of thousands of
 * directories and occasionally a test fixture database nobody wants listed.
 */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "target",
  "vendor",
  "Pods",
  ".venv",
  "__pycache__",
  ".gradle",
  "DerivedData",
]);

/** Deep enough for `packages/app/prisma/dev.db`, shallow enough to stay fast. */
const MAX_DEPTH = 5;

/** A file that is only a lock or journal is not a database you can open. */
const SIDECAR = /-(wal|shm|journal)$/;

export interface DiscoveredSqliteFile {
  /** Absolute path. */
  file: string;
  /** Repo the file was found in. */
  repo: string;
  /** Path relative to the repo root — what the UI shows. */
  relativePath: string;
  sizeBytes: number;
  modifiedAt: number;
}

function walk(dir: string, repoRoot: string, repo: string, depth: number, found: DiscoveredSqliteFile[]): void {
  if (depth > MAX_DEPTH || found.length >= 200) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory — a permissions quirk should skip, not throw.
    return;
  }

  for (const entry of entries) {
    if (found.length >= 200) return;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(full, repoRoot, repo, depth + 1, found);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SQLITE_EXTENSIONS.has(ext)) continue;
    if (SIDECAR.test(path.basename(entry.name, ext))) continue;

    try {
      const stat = fs.statSync(full);
      // A zero-byte file is a valid, empty SQLite database, but it is far more
      // often a placeholder that was never written.
      if (stat.size === 0) continue;
      found.push({
        file: full,
        repo,
        relativePath: path.relative(repoRoot, full),
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    } catch {
      // Vanished between readdir and stat.
    }
  }
}

/**
 * SQLite files across every tracked repo, most recently modified first.
 *
 * Enumerates the scan directory rather than calling `listRepos()`: that runs
 * git per repo to build its metadata, and none of it is needed to walk for
 * files.
 */
export function discoverSqliteFiles(): DiscoveredSqliteFile[] {
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return [];

  const found: DiscoveredSqliteFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scanDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(scanDir, entry.name);
    if (!fs.existsSync(path.join(repoPath, ".git"))) continue;
    walk(repoPath, repoPath, entry.name, 0, found);
  }

  return found.sort((a, b) => b.modifiedAt - a.modifiedAt);
}
