import fs from "node:fs";
import path from "node:path";

export function pathExists(file: string): boolean {
  try { fs.lstatSync(file); return true; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Inspect each component before reading, copying or deleting beneath a trusted root. */
export function safePath(root: string, destination: string, includeLeaf = true): boolean {
  const base = path.resolve(root);
  const relative = path.relative(base, path.resolve(destination));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const parts = relative ? relative.split(path.sep) : [];
  if (!includeLeaf) parts.pop();
  let current = base;
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = path.join(current, parts[index]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return false;
      if (index < parts.length - 1 && !stat.isDirectory()) return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
  }
  return true;
}

export function assertSafePath(root: string, destination: string): void {
  if (!safePath(root, destination)) throw new Error("A plugin location is not a safe regular path.");
}
