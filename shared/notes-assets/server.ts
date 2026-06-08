/**
 * Server-side note asset I/O (Node fs). Shared by dashboard and notes MCP.
 */
import fs from 'node:fs';
import path from 'node:path';

import { normalizeNoteAssetRelPath } from './markdown.ts';

export const ALLOWED_NOTE_ASSET_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export function isAllowedNoteAssetExtension(filename: string): boolean {
  const ext = path.posix.extname(filename).toLowerCase();
  return ALLOWED_NOTE_ASSET_EXTENSIONS.has(ext);
}

/** Validate a notes-relative asset path. Throws on traversal, .json paths, or disallowed types. */
export function assertNoteAssetRelPath(relPath: string): string {
  const normalized = normalizeNoteAssetRelPath(relPath.trim());
  if (!normalized) {
    throw new Error('Asset path is required');
  }
  if (normalized.split('/').includes('..')) {
    throw new Error('Path traversal blocked');
  }
  if (normalized.endsWith('.json')) {
    throw new Error('Asset path must not be a note (.json) file');
  }
  const base = path.posix.basename(normalized);
  if (!isAllowedNoteAssetExtension(base)) {
    throw new Error(`Unsupported asset type. Allowed: ${[...ALLOWED_NOTE_ASSET_EXTENSIONS].join(', ')}`);
  }
  return normalized;
}

/** Resolve a validated notes-relative asset path to an absolute path under the notes root. */
export function resolveNoteAssetUnderRoot(notesRoot: string, relPath: string): string {
  const normalized = assertNoteAssetRelPath(relPath);
  const root = path.resolve(notesRoot);
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  try {
    const real = fs.realpathSync(resolved);
    if (real !== root && !real.startsWith(root + path.sep)) {
      throw new Error('Path traversal blocked (symlink)');
    }
    return real;
  } catch (err) {
    if ((err as Error).message.startsWith('Path traversal')) throw err;
    return resolved;
  }
}

export function contentTypeForAssetExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export function contentTypeForAssetPath(assetPath: string): string {
  return contentTypeForAssetExtension(path.posix.extname(assetPath));
}

/** Atomic write of a notes-relative image asset under `notesRoot`. */
export function writeNoteAssetBytes(
  notesRoot: string,
  relPath: string,
  data: Buffer,
): { path: string; size: number; modified: number } {
  const normalized = assertNoteAssetRelPath(relPath);
  const resolved = resolveNoteAssetUnderRoot(notesRoot, normalized);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(resolved)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, resolved);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // tmp may not exist
    }
    throw err;
  }
  const stat = fs.statSync(resolved);
  return { path: normalized, size: stat.size, modified: stat.mtimeMs };
}

/** Read bytes for a notes-relative image asset under `notesRoot`, or `null` if missing. */
export function readNoteAssetBytes(notesRoot: string, relPath: string): Buffer | null {
  const normalized = assertNoteAssetRelPath(relPath);
  const resolved = resolveNoteAssetUnderRoot(notesRoot, normalized);
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return null;
  return fs.readFileSync(resolved);
}
