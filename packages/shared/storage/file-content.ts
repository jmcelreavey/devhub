import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tryAcquireProcessDirectoryLock } from "../process/directory-lock.ts";
import { searchNotes } from "../notes-search/search.ts";
import { resolveVaultPath } from "../vault/resolve-path.ts";
import { searchTextFiles } from "../vault/text-search.ts";
import {
  ContentConflictError,
  type ContentDirectory,
  type ContentEntry,
  type ContentFile,
  type ContentStorage,
} from "./content.ts";

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function hash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Files remain in their existing format. The shared lock coordinates MCP and core processes. */
export function createFileContentStorage(rootDir: string, options: { fileMode?: number; dirMode?: number; beforeWrite?: () => void } = {}): ContentStorage {
  const root = resolveVaultPath(rootDir, ".");
  function resolve(relative: string): string {
    if (resolveVaultPath(root, ".") !== root) throw new Error("Unsafe content root");
    const full = resolveVaultPath(root, relative);
    const first = path.relative(root, full).split(path.sep)[0];
    if (first === ".task-note-locks" || first === ".content-write.lock" || first.startsWith(".content-write.lock.")) {
      throw new Error("Reserved content path");
    }
    return full;
  }

  function file(relative: string): ContentFile | null {
    const full = resolve(relative);
    let fd: number;
    try {
      fd = fs.openSync(full, "r");
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) throw new Error(`Not a file: ${relative}`);
      const content = fs.readFileSync(fd);
      return { path: path.relative(root, full), content, revision: hash(content), modified: stat.mtimeMs, size: stat.size };
    } finally {
      fs.closeSync(fd);
    }
  }

  function exists(full: string): boolean {
    try { fs.lstatSync(full); return true; } catch (error) { if (missing(error)) return false; throw error; }
  }

  function sameFile(a: string, b: string): boolean {
    try {
      const source = fs.statSync(a);
      const destination = fs.statSync(b);
      return source.dev === destination.dev && source.ino === destination.ino;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }

  function directory(relative: string): ContentDirectory | null {
    const full = resolve(relative);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch (error) { if (missing(error)) return null; throw error; }
    if (!stat.isDirectory()) return null;
    const digest = createHash("sha256");
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        // The lock belongs to the adapter, not the contents of a vault.
        if (dir === root && (entry.name.startsWith(".content-write.lock") || entry.name === ".task-note-locks")) continue;
        const name = path.join(dir, entry.name);
        const rel = path.relative(full, name);
        if (entry.isSymbolicLink()) digest.update(`l\0${rel}\0${fs.readlinkSync(name)}\0`);
        else if (entry.isDirectory()) { digest.update(`d\0${rel}\0`); walk(name); }
        else if (entry.isFile()) { digest.update(`f\0${rel}\0${hash(fs.readFileSync(name))}\0`); }
        else throw new Error(`Unsupported directory entry: ${rel}`);
      }
    }
    walk(full);
    return { path: path.relative(root, full), revision: digest.digest("hex") };
  }

  function folderTaskNotes(relative: string): string[] {
    const full = resolve(relative);
    const taskRoot = path.join(root, "task-notes");
    if (full !== taskRoot && !full.startsWith(taskRoot + path.sep)) return [];
    const found: string[] = [];
    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (error) { if (missing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return; throw error; }
      for (const entry of entries) {
        const item = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(item);
        else if (entry.isFile() && entry.name.endsWith(".json")) found.push(path.relative(root, item));
      }
    }
    walk(full);
    return found.sort();
  }

  async function locked<T>(work: () => T, paths: string[] = [], folder?: string): Promise<T> {
    if (resolveVaultPath(root, ".") !== root) throw new Error("Unsafe content root");
    fs.mkdirSync(root, { recursive: true, mode: options.dirMode });
    // Re-check the root after creation, before using it for the lock.
    if (resolveVaultPath(root, ".") !== root) throw new Error("Unsafe content root");
    const lock = path.join(root, ".content-write.lock");
    const fixedTaskNotes = paths.map((item) => path.relative(root, resolve(item)))
      .filter((item) => item.startsWith(`task-notes${path.sep}`) && item.endsWith(".json"));
    const taskLockDir = path.join(root, ".task-note-locks");
    const deadline = Date.now() + 10_000;
    for (;;) {
      const release = tryAcquireProcessDirectoryLock(lock);
      if (release) {
        const taskReleases: Array<() => void> = [];
        try {
          const folderNotes = folder ? folderTaskNotes(folder) : [];
          const taskNotes = [...new Set([...fixedTaskNotes, ...folderNotes])].sort();
          if (taskNotes.length) {
            fs.mkdirSync(taskLockDir, { recursive: true, mode: 0o700 });
            if (fs.lstatSync(taskLockDir).isSymbolicLink() || fs.realpathSync(taskLockDir) !== taskLockDir) {
              throw new Error("Unsafe task note lock directory");
            }
          }
          for (const taskNote of taskNotes) {
            const key = path.join(taskLockDir, createHash("sha256").update(taskNote).digest("hex") + ".lock");
            const releaseTask = tryAcquireProcessDirectoryLock(key);
            if (!releaseTask) break;
            taskReleases.push(releaseTask);
          }
          if (taskReleases.length === taskNotes.length && (!folder || folderTaskNotes(folder).join("\0") === folderNotes.join("\0"))) {
            return work();
          }
        } finally {
          for (const releaseTask of taskReleases.reverse()) releaseTask();
          release();
        }
      }
      if (Date.now() >= deadline) throw new Error("Content is being edited elsewhere. Try again.");
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 20));
    }
  }

  function requireRevision(relative: string, expected: string | null): ContentFile | null {
    const full = resolve(relative);
    try {
      if (!fs.statSync(full).isFile()) throw new ContentConflictError(relative);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const current = file(relative);
    if ((current?.revision ?? null) !== expected) throw new ContentConflictError(relative);
    return current;
  }

  function requireDirectory(relative: string, expected: string): ContentDirectory {
    const current = directory(relative);
    if (!current || current.revision !== expected) throw new ContentConflictError(relative);
    return current;
  }

  function atomicWrite(full: string, content: string | Uint8Array): void {
    const dir = path.dirname(full);
    fs.mkdirSync(dir, { recursive: true, mode: options.dirMode });
    const tmp = path.join(dir, `.${path.basename(full)}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tmp, content, { flag: "wx", mode: options.fileMode });
      fs.renameSync(tmp, full);
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch (cleanup) { if (!missing(cleanup)) throw cleanup; }
      throw error;
    }
  }

  const assets = {
    async read(relative: string) { return file(relative); },
    async write(relative: string, content: string | Uint8Array, expected: string | null) {
      return locked(() => {
        options.beforeWrite?.();
        requireRevision(relative, expected);
        const full = resolve(relative);
        atomicWrite(full, content);
        return file(relative)!;
      }, [relative]);
    },
    async move(from: string, to: string, expected: string, expectedDestination: string | null = null) {
      return locked(() => {
        requireRevision(from, expected);
        const src = resolve(from);
        const dst = resolve(to);
        if (src !== dst) {
          // Case-only renames on case-insensitive filesystems identify the same file.
          if (expectedDestination !== null || !sameFile(src, dst)) requireRevision(to, expectedDestination);
          fs.mkdirSync(path.dirname(dst), { recursive: true, mode: options.dirMode });
          fs.renameSync(src, dst);
        }
        return file(to)!;
      }, [from, to]);
    },
    async delete(relative: string, expected: string) {
      return locked(() => {
        requireRevision(relative, expected);
        fs.unlinkSync(resolve(relative));
        return true;
      }, [relative]);
    },
  };

  function safeFolder(relative: string): string {
    const full = resolve(relative);
    if (full === root) throw new Error("Cannot modify the vault root");
    return full;
  }

  function list(relative = ""): ContentEntry[] {
    const full = resolve(relative);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(full, { withFileTypes: true }); }
    catch (error) { if (missing(error)) return []; throw error; }
    return entries.filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
      .flatMap((entry): ContentEntry[] => {
        const item = path.join(relative, entry.name);
        if (entry.isDirectory()) return [{ type: "dir", name: entry.name, path: item, children: list(item) }];
        if (entry.isFile()) return [{ type: "file", name: entry.name, path: item }];
        return [];
      }).sort((a, b) => a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name));
  }

  return {
    ...assets,
    assets,
    async list(relative) { return list(relative); },
    async search(query, searchOptions) {
      resolve("");
      if (searchOptions?.format === "docs") return searchTextFiles(root, ".md", query, searchOptions.limit);
      return searchNotes(root, query, searchOptions);
    },
    async readDirectory(relative) { return directory(relative); },
    async createDirectory(relative) {
      return locked(() => {
        const full = safeFolder(relative);
        if (exists(full)) throw new ContentConflictError(relative);
        fs.mkdirSync(full, { recursive: true, mode: options.dirMode });
        return directory(relative)!;
      });
    },
    async moveDirectory(from, to, expected) {
      return locked(() => {
        const src = safeFolder(from);
        const dst = safeFolder(to);
        requireDirectory(from, expected);
        if (exists(dst) || dst.startsWith(src + path.sep)) throw new ContentConflictError(to);
        fs.mkdirSync(path.dirname(dst), { recursive: true, mode: options.dirMode });
        fs.renameSync(src, dst);
        return directory(to)!;
      }, [], from);
    },
    async deleteDirectory(relative, expected) {
      return locked(() => {
        const full = safeFolder(relative);
        requireDirectory(relative, expected);
        fs.rmSync(full, { recursive: true });
        return true;
      }, [], relative);
    },
  };
}
