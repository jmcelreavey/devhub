import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tryAcquireProcessDirectoryLock } from "../process/directory-lock.ts";

// Different route bundles can load their own copy of this module in one process.
const processState = globalThis as typeof globalThis & { __devhubTaskNoteLocks?: Set<string> };
const held = processState.__devhubTaskNoteLocks ??= new Set<string>();

/** Serialise a task-note read and write across the dashboard and MCP processes. */
export function withTaskNoteFileLock<T>(root: string, file: string, work: () => T): T {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Path traversal blocked");
  const directory = path.join(resolvedRoot, ".task-note-locks");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) throw new Error("Unsafe task note lock directory");
  const key = path.join(directory, createHash("sha256").update(relative).digest("hex") + ".lock");
  if (held.has(key)) return work();
  const release = tryAcquireProcessDirectoryLock(key);
  if (!release) throw new Error("This task note is being edited elsewhere. Try again.");
  held.add(key);
  try { return work(); }
  finally { held.delete(key); release(); }
}
