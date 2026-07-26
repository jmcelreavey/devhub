import fs from "node:fs";
import path from "node:path";
import { getReposScanDir } from "@/lib/repos";

export function resolveRepoPath(name: string): string | null {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes("..")) return null;
  const scanDir = path.resolve(getReposScanDir());
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== scanDir) return null;
  if (!fs.existsSync(path.join(repoPath, ".git"))) return null;
  return repoPath;
}
