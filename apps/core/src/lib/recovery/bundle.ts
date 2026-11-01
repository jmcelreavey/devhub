import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { execExternal } from "../exec-external";

const MAGIC = Buffer.from("DEVHUBB1\n");
const HEADER_BYTES = MAGIC.length + 28;
const MAX_TOTAL = 1024 * 1024 * 1024;
const MAX_FILE = 256 * 1024 * 1024;
const MAX_FILES = 50_000;
const deriveKey = promisify(scrypt);
export interface BackupRoot { id: string; source: string; include?: string[] }
interface InventoryFile { name: string; source: string; size: number; mtime: number; ctime: number; inode: number }
export interface BundleManifest { format: "devhub-backup"; version: 1; createdAt: string; roots: BackupRoot[]; repositoriesRoot?: string }
interface RestoreOptions { repositoriesRoot?: string; failAfterFiles?: number; verifyOnly?: boolean }

function checkPassphrase(passphrase: string): void {
  if (passphrase.length < 12 || passphrase.length > 1024) throw new Error("Use a backup passphrase between 12 and 1,024 characters.");
}
function safeName(name: string): boolean {
  return !!name && name.length <= 4096 && !name.includes("\\") && !name.includes("\0") &&
    !path.posix.isAbsolute(name) && name.split("/").every(part => part && part !== "." && part !== "..");
}
function omitted(name: string): boolean {
  return [".git", ".cache", "node_modules", "locks"].includes(name) || /^\.next/.test(name) ||
    /\.(lock|tmp|pid|log)$/.test(name) || /-(wal|shm)$/.test(name);
}

export async function inventory(roots: BackupRoot[]): Promise<InventoryFile[]> {
  const files: InventoryFile[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const root of roots) {
    if (!/^[a-z][a-z0-9-]*$/.test(root.id) || ids.has(root.id) || !path.isAbsolute(root.source)) throw new Error("Invalid backup store.");
    ids.add(root.id);
    async function walk(dir: string, relative: string): Promise<void> {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (omitted(entry.name)) continue;
        const rel = relative ? relative + "/" + entry.name : entry.name;
        if (!relative && root.include && !root.include.includes(entry.name)) continue;
        const source = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Backup contains a symbolic link: " + root.id + "/" + rel);
        if (entry.isDirectory()) { await walk(source, rel); continue; }
        if (!entry.isFile()) throw new Error("Backup contains a non-file: " + root.id + "/" + rel);
        const stat = await fsp.stat(source);
        bytes += stat.size;
        if (stat.size > MAX_FILE || bytes > MAX_TOTAL || files.length >= MAX_FILES) throw new Error("Backup exceeds the limit: 1 GiB total, 256 MiB per file, 50,000 files.");
        files.push({ name: root.id + "/" + rel, source, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, inode: stat.ino });
      }
    }
    const stat = await fsp.lstat(root.source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Backup store is not a real directory: " + root.id);
    await walk(root.source, "");
  }
  return files;
}

async function sqliteSnapshot(source: string, destination: string): Promise<boolean> {
  const handle = await fsp.open(source, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (header.toString("latin1") !== "SQLite format 3\0") return false;
  await execExternal(process.execPath, ["-e",
    'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true,timeout:10000});try{db.prepare("VACUUM INTO ?").run(process.argv[2]);}finally{db.close();}',
    source, destination], { timeoutMs: 30_000, maxBuffer: 32_000, label: "recovery:sqlite-snapshot" });
  return true;
}

export async function createBundle(roots: BackupRoot[], passphrase: string, output: string, repositoriesRoot?: string): Promise<{ files: number; bytes: number }> {
  checkPassphrase(passphrase);
  const files = await inventory(roots);
  const manifest: BundleManifest = { format: "devhub-backup", version: 1, createdAt: new Date().toISOString(), roots, repositoriesRoot };
  const salt = randomBytes(16), iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const key = await deriveKey(passphrase, salt, 32) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "devhub-backup-"));
  let total = 0, created = false;
  async function* records() {
    yield JSON.stringify({ manifest }) + "\n";
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const before = await fsp.lstat(file.source);
      if (!before.isFile() || before.isSymbolicLink()) throw new Error("A backup source changed. Try again.");
      const snapshot = path.join(temporary, String(index) + ".sqlite");
      const sqlite = await sqliteSnapshot(file.source, snapshot);
      const source = sqlite ? snapshot : file.source;
      const stat = await fsp.stat(source);
      if (stat.size > MAX_FILE || total + stat.size > MAX_TOTAL) throw new Error("Backup exceeds its size limit.");
      yield JSON.stringify({ file: file.name, bytes: stat.size }) + "\n";
      const hash = createHash("sha256");
      let fileBytes = 0;
      for await (const raw of fs.createReadStream(source, { highWaterMark: 48 * 1024 })) {
        const chunk = raw as Buffer;
        total += chunk.length;
        fileBytes += chunk.length;
        if (fileBytes > stat.size || total > MAX_TOTAL) throw new Error("A backup source grew during capture. Try again.");
        hash.update(chunk);
        yield JSON.stringify({ data: chunk.toString("base64") }) + "\n";
      }
      const sha256 = hash.digest("hex");
      const assetHash = path.basename(file.name).match(/^([a-f0-9]{64})\.(png|jpg|gif|webp)$/)?.[1];
      if (assetHash && assetHash !== sha256) throw new Error("An image failed its integrity check: " + file.name);
      yield JSON.stringify({ end: sha256 }) + "\n";
      const after = await fsp.lstat(file.source);
      if (!sqlite && (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || before.ino !== after.ino)) throw new Error("A backup source changed. Try again when work is idle.");
      if (sqlite) await fsp.unlink(snapshot);
    }
    if (JSON.stringify(await inventory(roots)) !== JSON.stringify(files)) throw new Error("Backup files changed during capture. Try again.");
    yield JSON.stringify({ complete: files.length }) + "\n";
  }
  try {
    await fsp.writeFile(output, header, { flag: "wx", mode: 0o600 });
    created = true;
    await pipeline(Readable.from(records()), createGzip(), cipher, fs.createWriteStream(output, { flags: "a", mode: 0o600 }));
    await fsp.appendFile(output, cipher.getAuthTag());
    await restoreBundle(output, passphrase, temporary, { verifyOnly: true });
    return { files: files.length, bytes: (await fsp.stat(output)).size };
  } catch (error) {
    if (created) await fsp.rm(output, { force: true });
    throw error;
  } finally {
    key.fill(0);
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

function remap(value: unknown, mappings: Array<[string, string]>): unknown {
  if (typeof value === "string") {
    for (const [from, to] of mappings) {
      if (value === from) return to;
      if (value.startsWith(from + "/") || value.startsWith(from + "\\")) return path.join(to, ...value.slice(from.length + 1).split(/[\\/]/));
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => remap(item, mappings));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, mappings)]));
  return value;
}

export async function restoreBundle(bundle: string, passphrase: string, parent: string, options: RestoreOptions = {}) {
  checkPassphrase(passphrase);
  const parentStat = await fsp.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("Choose an existing real folder for recovery.");
  const info = await fsp.stat(bundle);
  if (info.size < HEADER_BYTES + 16 || info.size > MAX_TOTAL * 1.5) throw new Error("Backup is empty or too large.");
  const handle = await fsp.open(bundle, "r");
  const header = Buffer.alloc(HEADER_BYTES), tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, 16, info.size - 16);
  } finally { await handle.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Unsupported DevHub backup format.");
  const key = await deriveKey(passphrase, header.subarray(MAGIC.length, MAGIC.length + 16), 32) as Buffer;
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length + 16));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const destination = await fsp.mkdtemp(path.join(await fsp.realpath(parent), "devhub-restored-"));
  let manifest: BundleManifest | undefined;
  let current: { name: string; handle: FileHandle; bytes: number; read: number; hash: ReturnType<typeof createHash> } | undefined;
  const seen = new Set<string>();
  let total = 0, expanded = 0, complete = false, buffer = "";
  const decoder = new StringDecoder("utf8");
  async function consume(line: string) {
    if (complete) throw new Error("Unexpected data after backup completion.");
    const value = JSON.parse(line) as Record<string, unknown>;
    if (!manifest) {
      const candidate = value.manifest as BundleManifest | undefined;
      if (candidate?.format !== "devhub-backup" || candidate.version !== 1 || !Array.isArray(candidate.roots) || candidate.roots.length > 40 ||
        new Set(candidate.roots.map(root => root?.id)).size !== candidate.roots.length ||
        candidate.roots.some(root => !root || !/^[a-z][a-z0-9-]*$/.test(root.id) || typeof root.source !== "string" || !(path.posix.isAbsolute(root.source) || path.win32.isAbsolute(root.source)))) throw new Error("Invalid backup manifest.");
      manifest = candidate;
      return;
    }
    if (typeof value.file === "string") {
      const name = value.file;
      if (current || !safeName(name) || seen.has(name) || seen.size >= MAX_FILES || !manifest.roots.some(root => name.startsWith(root.id + "/")) ||
        typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_FILE) throw new Error("Invalid backup file.");
      seen.add(name);
      const target = path.join(destination, ...name.split("/"));
      await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      current = { name, handle: await fsp.open(target, "wx", 0o600), bytes: value.bytes, read: 0, hash: createHash("sha256") };
      return;
    }
    if (typeof value.data === "string") {
      if (!current || value.data.length > 70_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new Error("Invalid backup data.");
      const chunk = Buffer.from(value.data, "base64");
      current.read += chunk.length;
      total += chunk.length;
      if (current.read > current.bytes || total > MAX_TOTAL) throw new Error("Backup exceeds its declared size.");
      current.hash.update(chunk);
      await current.handle.writeFile(chunk);
      return;
    }
    if (typeof value.end === "string") {
      if (!current || current.read !== current.bytes || current.hash.digest("hex") !== value.end) throw new Error("Backup file failed its integrity check.");
      await current.handle.close();
      current = undefined;
      if (options.failAfterFiles && seen.size >= options.failAfterFiles) throw new Error("Injected restore failure.");
      return;
    }
    if (value.complete === seen.size && !current) { complete = true; return; }
    throw new Error("Invalid backup record.");
  }
  try {
    await fsp.chmod(destination, 0o700);
    await pipeline(fs.createReadStream(bundle, { start: HEADER_BYTES, end: info.size - 17 }), decipher, createGunzip(),
      async function (source) {
        for await (const chunk of source) {
          expanded += chunk.length;
          if (expanded > MAX_TOTAL * 1.5) throw new Error("Expanded backup exceeds its limit.");
          buffer += decoder.write(chunk);
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            if (newline > 256_000) throw new Error("Backup record is too large.");
            await consume(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
          }
          if (buffer.length > 256_000) throw new Error("Backup record is too large.");
        }
      });
    buffer += decoder.end();
    if (!manifest || !complete || buffer || current) throw new Error("Backup is incomplete.");
    if (!options.verifyOnly) {
      for (const root of manifest.roots) await fsp.mkdir(path.join(destination, root.id), { recursive: true, mode: 0o700 });
      const mappings: Array<[string, string]> = manifest.roots.map(root => [root.source, path.join(destination, root.id)]);
      if (options.repositoriesRoot) {
        if (!path.isAbsolute(options.repositoriesRoot) || !manifest.repositoriesRoot) throw new Error("Repository remapping needs absolute source and destination roots.");
        mappings.push([manifest.repositoriesRoot, options.repositoriesRoot]);
      }
      mappings.sort((a, b) => b[0].length - a[0].length);
      // Only configuration is remapped; notes, history and source receipts keep their original text.
      for (const name of seen) {
        if (!/^(config|app-config|environment)\//.test(name)) continue;
        const file = path.join(destination, name);
        const body = await fsp.readFile(file, "utf8");
        if (name.endsWith(".json")) await fsp.writeFile(file, JSON.stringify(remap(JSON.parse(body), mappings), null, 2), { mode: 0o600 });
        else if (name.endsWith(".env.local")) await fsp.writeFile(file, body.split("\n").map(line => {
          const match = /^([A-Z_]+)=(.*)$/.exec(line);
          if (!match || !/^(NOTES_DIR|TASKS_DIR|COLLECTIONS_DIR|REPS_DIR|UPSTARTS_DIR|REPO_ROOT|DEVHUB_REPOS_DIR|DEVHUB_NOTE_MEDIA_DIR)$/.test(match[1])) return line;
          const raw = match[2].replace(/^["']|["']$/g, "");
          return match[1] + "=" + JSON.stringify(remap(raw, mappings));
        }).join("\n"), { mode: 0o600 });
      }
      await fsp.writeFile(path.join(destination, "recovery.json"), JSON.stringify({
        ...manifest, restoredAt: new Date().toISOString(), files: seen.size, repositoriesRoot: options.repositoriesRoot ?? manifest.repositoriesRoot,
        stores: manifest.roots.map(root => ({ id: root.id, path: path.join(destination, root.id) })),
        next: "Review recovered configuration, relink repositories in Setup, and reconnect Keychain-backed integrations before using these stores. Nothing has replaced the live installation.",
      }, null, 2), { mode: 0o600 });
    } else await fsp.rm(destination, { recursive: true, force: true });
    return { destination, files: seen.size, bytes: total };
  } catch (error) {
    await current?.handle.close().catch(() => {});
    await fsp.rm(destination, { recursive: true, force: true });
    throw new Error("Restore failed; its temporary files were rolled back. " + (error instanceof Error ? error.message : "Check the passphrase and backup."));
  } finally { key.fill(0); }
}
