import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";

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
