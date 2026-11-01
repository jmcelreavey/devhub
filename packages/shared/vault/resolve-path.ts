import fs from "node:fs";
import path from "node:path";

// Resolve the closest existing ancestor as well as paths that do not exist yet.
export function canonicalPath(file: string): string {
  let ancestor = file;
  for (;;) {
    try {
      fs.lstatSync(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  // A dangling symlink is not a safe missing path.
  let real: string;
  try {
    real = fs.realpathSync(ancestor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Path traversal blocked (dangling symlink)");
    throw error;
  }
  return path.resolve(real, path.relative(ancestor, file));
}

export function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function resolveVaultPath(rootDir: string, relativePath: string): string {
  const root = canonicalPath(path.resolve(rootDir));
  const file = path.resolve(root, relativePath);
  if (!isWithin(root, file) || !isWithin(root, canonicalPath(file))) {
    throw new Error("Path traversal blocked (symlink)");
  }
  return file;
}

