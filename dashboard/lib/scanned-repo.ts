import path from "node:path";
import fs from "node:fs";
import { getGithubFullNameForLocalRepo, getReposScanDir } from "@/lib/repos";

/** Resolve a scanned local repo by folder name. Rejects path traversal. */
export function resolveScannedRepo(name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  const scanDir = getReposScanDir();
  const rp = path.resolve(path.join(scanDir, name));
  if (path.dirname(rp) !== path.resolve(scanDir)) return null;
  if (!fs.existsSync(path.join(rp, ".git"))) return null;
  return rp;
}

/** Match a GitHub `owner/name` to a sibling clone via its origin remote. */
export function findScannedRepoByGithubFullName(
  fullName: string,
): { name: string; path: string } | null {
  const wanted = fullName.trim().toLowerCase();
  if (!wanted || wanted.includes("..")) return null;
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return null;
  try {
    for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(scanDir, entry.name);
      if (!fs.existsSync(path.join(repoPath, ".git"))) continue;
      const remoteName = getGithubFullNameForLocalRepo(repoPath);
      if (remoteName?.toLowerCase() === wanted) {
        return { name: entry.name, path: repoPath };
      }
    }
  } catch {
    return null;
  }
  return null;
}
