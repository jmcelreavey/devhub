import fs from "node:fs";
import path from "node:path";

function isIgnoredMeaningfulFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === ".DS_Store" || base.endsWith(".pyc") || filePath.split(path.sep).includes("__pycache__");
}

export function filesEqual(left: string, right: string): boolean {
  try {
    const leftStat = fs.lstatSync(left);
    const rightStat = fs.lstatSync(right);
    if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) {
      return leftStat.isSymbolicLink() && rightStat.isSymbolicLink() && fs.readlinkSync(left) === fs.readlinkSync(right);
    }
    if (!leftStat.isFile() || !rightStat.isFile()) return false;
    if (leftStat.size !== rightStat.size) return false;
    return fs.readFileSync(left).equals(fs.readFileSync(right));
  } catch {
    return false;
  }
}

export function treesEqual(left: string, right: string): boolean {
  try {
    const leftStat = fs.lstatSync(left);
    const rightStat = fs.lstatSync(right);
    if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) return filesEqual(left, right);
    if (leftStat.isFile() || rightStat.isFile()) return filesEqual(left, right);
    if (!leftStat.isDirectory() || !rightStat.isDirectory()) return false;

    const leftEntries = fs.readdirSync(left, { withFileTypes: true }).map((entry) => entry.name).sort();
    const rightEntries = fs.readdirSync(right, { withFileTypes: true }).map((entry) => entry.name).sort();
    if (leftEntries.length !== rightEntries.length) return false;
    for (let i = 0; i < leftEntries.length; i++) {
      if (leftEntries[i] !== rightEntries[i]) return false;
      if (!treesEqual(path.join(left, leftEntries[i]), path.join(right, rightEntries[i]))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function newestMeaningfulMtimeMs(targetPath: string): number | null {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) return stat.mtimeMs;
    if (stat.isFile()) return isIgnoredMeaningfulFile(targetPath) ? null : stat.mtimeMs;
    if (!stat.isDirectory()) return stat.mtimeMs;

    let newest: number | null = null;
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      const childPath = path.join(targetPath, entry.name);
      if (isIgnoredMeaningfulFile(childPath)) continue;
      const childNewest = newestMeaningfulMtimeMs(childPath);
      if (childNewest == null) continue;
      newest = newest == null ? childNewest : Math.max(newest, childNewest);
    }
    return newest;
  } catch {
    return null;
  }
}
