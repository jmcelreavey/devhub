import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isValidProfileId } from "../vault/task-profiles.ts";

const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})(?:\.local)?\.json$/;
const CONFLICT_RE = /^[0-9a-f]{12}-(\d{4}-\d{2}-\d{2})(?:\.local)?\.json$/;
const ID_RE = /^[a-zA-Z0-9_-]{1,200}$/;

export function isTaskId(id: string): boolean {
  return ID_RE.test(id);
}

export function itemsDir(tasksDir: string): string {
  return path.join(tasksDir, "items");
}

export function itemPath(tasksDir: string, id: string): string {
  if (!isTaskId(id)) throw new Error(`Invalid task id: ${id}`);
  return path.join(itemsDir(tasksDir), `${id}.json`);
}

export function timerPath(tasksDir: string): string {
  return path.join(tasksDir, ".local", "timers.json");
}

/** Day-files at the root of a tasks dir, plus anything already moved under legacy/. */
export function listLegacyFiles(tasksDir: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "legacy") visit(full);
        else if (dir.endsWith(`${path.sep}legacy`) || path.basename(dir) === "legacy") visit(full);
        continue;
      }
      const inConflicts = path.basename(dir) === "conflicts";
      if (entry.isFile() && (DAY_FILE_RE.test(entry.name) || (inConflicts && CONFLICT_RE.test(entry.name)))) found.push(full);
    }
  };
  visit(tasksDir);
  const legacy = path.join(tasksDir, "legacy");
  if (fs.existsSync(legacy)) visit(legacy);
  return [...new Set(found)].sort();
}

export function legacyFileDate(filePath: string): string | null {
  const base = path.basename(filePath);
  return base.match(DAY_FILE_RE)?.[1] ?? base.match(CONFLICT_RE)?.[1] ?? null;
}

/** Profile directories under a tasks root. `items` and `legacy` are reserved. */
export function profileDirs(tasksRoot: string): string[] {
  return listProfileIds(tasksRoot).map((id) => path.join(tasksRoot, id));
}

export function listProfileIds(tasksRoot: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && isValidProfileId(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

export function fingerprintFiles(tasksDir: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(path.relative(tasksDir, file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
