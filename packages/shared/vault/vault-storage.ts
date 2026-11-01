import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createFileContentStorage } from "../storage/file-content.ts";
import type { ContentStorage } from "../storage/content.ts";
import { canonicalPath, isWithin } from "./resolve-path.ts";
import { searchTextFiles } from "./text-search.ts";
export { resolveVaultPath } from "./resolve-path.ts";
export { searchTextFiles, type TextSearchResult } from "./text-search.ts";
import type { TextSearchResult } from "./text-search.ts";
import type { VaultCodec } from "./vault-codec.ts";
import { withTaskNoteFileLock } from "./note-lock.ts";

export interface TreeEntry {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeEntry[];
  size?: number;
  modified?: number;
}

export interface VaultFileResult {
  path: string;
  content: unknown;
  modified: number;
  size: number;
  revision?: string;
}

export class VaultStorage {
  readonly root: string;
  readonly codec: VaultCodec;
  readonly content: ContentStorage;

  constructor(rootDir: string, codec: VaultCodec) {
    this.codec = codec;
    this.root = canonicalPath(path.resolve(rootDir));
    this.content = createFileContentStorage(this.root);
  }

  private get ext(): string {
    return this.codec.extension;
  }

  protected confined(file: string): string {
    if (!isWithin(this.root, file)) throw new Error("Path traversal blocked");
    const root = canonicalPath(this.root);
    if (path.relative(this.root, root) || !isWithin(root, canonicalPath(file))) {
      throw new Error("Path traversal blocked (symlink)");
    }
    return file;
  }

  private _resolveListingDir(relPath: string): string {
    const normalized = path.normalize(relPath);
    if (normalized.split(path.sep).includes("..")) {
      throw new Error("Path traversal blocked");
    }
    return this.confined(path.resolve(this.root, normalized));
  }

  private _resolve(filePath: string): string {
    if (!filePath.endsWith(this.ext)) {
      filePath += this.ext;
    }
    return this.confined(path.resolve(this.root, filePath));
  }

  list(dir = ""): TreeEntry[] {
    const target = this._resolveListingDir(dir);
    if (!fs.existsSync(target)) return [];

    const entries: TreeEntry[] = [];
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = path.join(target, entry.name);
      const relPath = path.relative(this.root, fullPath);

      if (entry.isDirectory()) {
        entries.push({
          type: "dir",
          name: entry.name,
          path: relPath,
          children: this.list(relPath),
        });
      } else if (entry.isFile() && entry.name.endsWith(this.ext)) {
        const stat = fs.statSync(fullPath);
        entries.push({
          type: "file",
          name: entry.name,
          path: relPath,
          size: stat.size,
          modified: stat.mtimeMs,
        });
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  read(filePath: string): VaultFileResult | null {
    const resolved = this._resolve(filePath);
    if (!fs.existsSync(resolved)) return null;

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return null;

    const raw = fs.readFileSync(resolved, "utf-8");
    return {
      path: path.relative(this.root, resolved),
      content: this.codec.parse(raw),
      revision: createHash("sha256").update(raw).digest("hex"),
      modified: stat.mtimeMs,
      size: stat.size,
    };
  }

  readRaw(filePath: string): string | null {
    const resolved = this._resolve(filePath);
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, "utf-8");
  }

  withLock<T>(filePath: string, work: () => T): T {
    const resolved = this._resolve(filePath);
    const relative = path.relative(this.root, resolved);
    if (!relative.startsWith(`task-notes${path.sep}`) || this.ext !== ".json") return work();
    fs.mkdirSync(this.root, { recursive: true });
    const root = fs.realpathSync(this.root);
    return withTaskNoteFileLock(root, path.join(root, relative), work);
  }

  async write(filePath: string, content: unknown, expectedRevision: string | null = null): Promise<VaultFileResult> {
    const relative = path.relative(this.root, this._resolve(filePath));
    const file = await this.content.write(relative, this.codec.serialize(content), expectedRevision);
    return { ...file, content: this.codec.parse(file.content.toString("utf8")) };
  }

  async delete(filePath: string, expectedRevision?: string): Promise<boolean> {
    const relative = path.relative(this.root, this._resolve(filePath));
    const current = await this.content.read(relative);
    if (!current && expectedRevision === undefined) return false;
    return this.content.delete(relative, expectedRevision ?? current!.revision);
  }

  async rename(oldPath: string, newPath: string, expectedRevision?: string): Promise<VaultFileResult | null> {
    const source = path.relative(this.root, this._resolve(oldPath));
    const destination = path.relative(this.root, this._resolve(newPath));
    const current = await this.content.read(source);
    if (!current && expectedRevision === undefined) return null;
    const file = await this.content.move(source, destination, expectedRevision ?? current!.revision);
    return { ...file, content: this.codec.parse(file.content.toString("utf8")) };
  }

  private directoryPath(relative: string): string {
    return path.relative(this.root, this._resolveListingDir(relative.trim().replace(/\\/g, path.sep)));
  }

  readDirectory(relative: string) {
    return this.content.readDirectory(this.directoryPath(relative));
  }

  async renameDir(oldPath: string, newPath: string, expectedRevision?: string) {
    const source = this.directoryPath(oldPath);
    const destination = this.directoryPath(newPath);
    if (!source || !destination || destination.startsWith(source + path.sep)) return null;
    const current = await this.content.readDirectory(source);
    if (!current && expectedRevision === undefined) return null;
    return this.content.moveDirectory(source, destination, expectedRevision ?? current!.revision);
  }

  async deleteDir(relative: string, expectedRevision?: string): Promise<boolean> {
    const directory = this.directoryPath(relative);
    if (!directory) return false;
    const current = await this.content.readDirectory(directory);
    if (!current && expectedRevision === undefined) return false;
    return this.content.deleteDirectory(directory, expectedRevision ?? current!.revision);
  }

  async createDir(relative: string) {
    return this.content.createDirectory(this.directoryPath(relative));
  }

  private walkVaultFiles(dir: string, callback: (fullPath: string, relPath: string) => void): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkVaultFiles(fullPath, callback);
      } else if (entry.isFile() && entry.name.endsWith(this.ext)) {
        callback(fullPath, path.relative(this.root, fullPath));
      }
    }
  }

  searchText(query: string, limit = 50): TextSearchResult[] {
    return searchTextFiles(this.confined(this.root), this.ext, query, limit);
  }

  getAllVaultFiles(): string[] {
    const files: string[] = [];
    this.walkVaultFiles(this.confined(this.root), (_fullPath, relPath) => files.push(relPath));
    return files.sort();
  }
}

