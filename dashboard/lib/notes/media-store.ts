/**
 * Local, content-addressed store for images pasted/dropped into notes.
 *
 * Blobs live under `profileStateDir()/note-media` (not the git-tracked notes
 * vault) as `<sha256>.<ext>`; a note only stores the stable
 * `/api/notes-media/<sha256>.<ext>` URL. Format and extension come from the
 * bytes, never from the client-supplied MIME or filename.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { profileStateDir } from "@/lib/profile-state";

export const NOTE_MEDIA_MAX_BYTES = 8_000_000;
export const NOTE_MEDIA_API_PREFIX = "/api/notes-media/";

const MEDIA_NAME_RE = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;

const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const;

export type NoteMediaExt = keyof typeof MIME_BY_EXT;

export function noteMediaDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const override = env.DEVHUB_NOTE_MEDIA_DIR?.trim();
  return override ? path.resolve(override) : path.join(profileStateDir(env), "note-media");
}

/** Raster format from magic bytes; null for SVG/HTML/anything unknown. */
export function sniffNoteMediaExt(bytes: Uint8Array): NoteMediaExt | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return "png";
  }
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  const head = Buffer.from(bytes.subarray(0, 12)).toString("latin1");
  if (/^GIF8[79]a/.test(head)) return "gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  return null;
}

export function isNoteMediaName(name: string): boolean {
  return MEDIA_NAME_RE.test(name);
}

export function noteMediaMime(name: string): string | null {
  if (!isNoteMediaName(name)) return null;
  return MIME_BY_EXT[name.slice(name.lastIndexOf(".") + 1) as NoteMediaExt];
}

export function noteMediaUrl(name: string): string {
  return `${NOTE_MEDIA_API_PREFIX}${name}`;
}

export interface StoredNoteMedia {
  name: string;
  url: string;
  mime: string;
  size: number;
  /** False when identical bytes were already stored. */
  created: boolean;
}

/** Validate and store one image; throws a user-facing Error on rejection. */
export function storeNoteMedia(bytes: Buffer, dir: string = noteMediaDir()): StoredNoteMedia {
  if (bytes.length === 0) throw new Error("Image is empty.");
  if (bytes.length > NOTE_MEDIA_MAX_BYTES) {
    throw new Error(`Image is too big (${Math.round(NOTE_MEDIA_MAX_BYTES / 1_048_576)} MB max).`);
  }
  const ext = sniffNoteMediaExt(bytes);
  if (!ext) throw new Error("Only PNG, JPEG, GIF and WebP images are supported.");

  const name = `${crypto.createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  const target = path.join(dir, name);
  const meta = { name, url: noteMediaUrl(name), mime: MIME_BY_EXT[ext], size: bytes.length };
  if (fs.existsSync(target)) return { ...meta, created: false };

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${name}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { ...meta, created: true };
}

/** Bytes for a stored image, or null when the name is invalid or missing. */
export function readNoteMedia(name: string, dir: string = noteMediaDir()): Buffer | null {
  if (!isNoteMediaName(name)) return null;
  try {
    return fs.readFileSync(path.join(dir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
