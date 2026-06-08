import fs from "node:fs";
import path from "node:path";
import { writeAtomicNow } from "./atomic-write.ts";
import type { VaultCodec } from "./vault-codec.ts";

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
}

export interface TextSearchResult {
  path: string;
  line: number;
  text: string;
  score: number;
}

export class VaultStorage {
  readonly root: string;
  readonly codec: VaultCodec;

  constructor(rootDir: string, codec: VaultCodec) {
    this.codec = codec;
    this.root = path.resolve(rootDir);
    try {
      this.root = fs.realpathSync(this.root);
    } catch {
      // Root doesn't exist yet; realpathSync will succeed after first write
    }
  }

  private get ext(): string {
    return this.codec.extension;
  }

  private _resolveListingDir(relPath: string): string {
    const normalized = path.normalize(relPath);
    if (normalized.split(path.sep).includes("..")) {
      throw new Error("Path traversal blocked");
    }
    const resolved = path.resolve(this.root, normalized);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error("Path traversal blocked");
    }
    return resolved;
  }

  private _resolve(filePath: string): string {
    if (!filePath.endsWith(this.ext)) {
      filePath += this.ext;
    }
    const resolved = path.resolve(this.root, filePath);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error("Path traversal blocked");
    }
    try {
      const real = fs.realpathSync(resolved);
      if (real !== this.root && !real.startsWith(this.root + path.sep)) {
        throw new Error("Path traversal blocked (symlink)");
      }
    } catch (err) {
      if ((err as Error).message.startsWith("Path traversal")) throw err;
    }
    return resolved;
  }

  list(dir = ""): TreeEntry[] {
    const target = dir ? this._resolveListingDir(dir) : this.root;
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
      } else if (entry.name.endsWith(this.ext)) {
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
      modified: stat.mtimeMs,
      size: stat.size,
    };
  }

  readRaw(filePath: string): string | null {
    const resolved = this._resolve(filePath);
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, "utf-8");
  }

  write(filePath: string, content: unknown): VaultFileResult {
    const resolved = this._resolve(filePath);
    const data = this.codec.serialize(content);
    writeAtomicNow(resolved, data);
    const stat = fs.statSync(resolved);
    return {
      path: path.relative(this.root, resolved),
      content: this.codec.parse(data),
      modified: stat.mtimeMs,
      size: stat.size,
    };
  }

  delete(filePath: string): boolean {
    const resolved = this._resolve(filePath);
    if (!fs.existsSync(resolved)) return false;
    fs.unlinkSync(resolved);
    return true;
  }

  private _sameFile(a: string, b: string): boolean {
    try {
      const srcStat = fs.statSync(a);
      const dstStat = fs.statSync(b);
      return srcStat.dev === dstStat.dev && srcStat.ino === dstStat.ino;
    } catch {
      return false;
    }
  }

  rename(oldPath: string, newPath: string): VaultFileResult | null {
    const src = this._resolve(oldPath);
    const dst = this._resolve(newPath);
    if (!fs.existsSync(src)) return null;

    if (src === dst) {
      return this.read(oldPath);
    }

    if (fs.existsSync(dst) && !this._sameFile(src, dst)) {
      return null;
    }

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    const stat = fs.statSync(dst);
    const raw = fs.readFileSync(dst, "utf-8");
    return {
      path: path.relative(this.root, dst),
      content: this.codec.parse(raw),
      modified: stat.mtimeMs,
      size: stat.size,
    };
  }

  renameDir(oldPath: string, newPath: string): { path: string } | null {
    const src = this._resolveListingDir(oldPath.trim().replace(/\\/g, path.sep));
    const dst = this._resolveListingDir(newPath.trim().replace(/\\/g, path.sep));
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return null;
    if (fs.existsSync(dst)) return null;
    if (dst.startsWith(src + path.sep)) return null;

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { path: path.relative(this.root, dst) };
  }

  deleteDir(relPath: string): boolean {
    const normalized = path.normalize(relPath.trim().replace(/\\/g, path.sep));
    if (!normalized || normalized === ".") return false;
    if (normalized.split(path.sep).includes("..")) {
      throw new Error("Path traversal blocked");
    }
    const resolved = path.resolve(this.root, normalized);
    if (resolved === this.root || !resolved.startsWith(this.root + path.sep)) {
      return false;
    }
    if (!fs.existsSync(resolved)) return false;
    if (!fs.statSync(resolved).isDirectory()) return false;
    fs.rmSync(resolved, { recursive: true, force: true });
    return true;
  }

  private walkVaultFiles(dir: string, callback: (fullPath: string, relPath: string) => void): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkVaultFiles(fullPath, callback);
      } else if (entry.name.endsWith(this.ext)) {
        callback(fullPath, path.relative(this.root, fullPath));
      }
    }
  }

  searchText(query: string, limit = 50): TextSearchResult[] {
    return searchTextFiles(this.root, this.ext, query, limit);
  }

  getAllVaultFiles(): string[] {
    const files: string[] = [];
    this.walkVaultFiles(this.root, (_fullPath, relPath) => files.push(relPath));
    return files.sort();
  }
}

function walkExtensionFiles(
  dir: string,
  extension: string,
  root: string,
  out: string[],
): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkExtensionFiles(fullPath, extension, root, out);
    } else if (entry.name.endsWith(extension)) {
      out.push(path.relative(root, fullPath));
    }
  }
}

export function searchTextFiles(
  root: string,
  extension: string,
  query: string,
  limit = 50,
): TextSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const files: string[] = [];
  walkExtensionFiles(root, extension, root, files);

  const results: TextSearchResult[] = [];
  const extRe = new RegExp(`${extension.replace(".", "\\.")}$`);

  for (const relPath of files) {
    const fullPath = path.join(root, relPath);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().includes(q)) continue;
      const idx = line.toLowerCase().indexOf(q);
      results.push({
        path: relPath.replace(extRe, ""),
        line: i + 1,
        text: line.trim(),
        score: 100 - idx,
      });
      if (results.length >= limit) return results.sort((a, b) => b.score - a.score);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
