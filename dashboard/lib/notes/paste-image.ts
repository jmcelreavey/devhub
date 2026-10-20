/**
 * Client-safe helpers for pasting / dropping images into the notes editor.
 * Blobs are stored by `POST /api/notes-media` (local state dir, hash-addressed);
 * the note keeps only the returned `/api/notes-media/<hash>.<ext>` URL.
 */

import { isImageAttach } from "@/lib/image-file";

export const NOTES_PASTE_IMAGE_MAX_BYTES = 8_000_000;

const PASTE_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** True when the File is a raster image we accept (png, jpeg, gif, webp). */
export function isNotePasteImageFile(file: File): boolean {
  if (!isImageAttach(file.type || "", file.name || "paste.png")) return false;
  const ext = extForNotePasteImage(file.type || "", file.name || "");
  return PASTE_IMAGE_EXTS.has(ext);
}

export function extForNotePasteImage(mime: string, name = ""): string {
  const type = mime.toLowerCase().trim();
  if (type === "image/jpeg") return "jpg";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  if (type === "image/png") return "png";
  const base = name.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase();
    if (ext === "jpeg") return "jpg";
    if (PASTE_IMAGE_EXTS.has(ext)) return ext;
  }
  return "png";
}

/** Client-side pre-checks so rejections never cost an upload. Returns an error message or null. */
export function validateNotePasteImage(file: File): string | null {
  if (!isNotePasteImageFile(file)) {
    return `${file.name || "file"} isn’t a supported image (PNG, JPEG, GIF or WebP).`;
  }
  if (file.size <= 0) return `${file.name || "image"} is empty.`;
  if (file.size > NOTES_PASTE_IMAGE_MAX_BYTES) {
    return `${file.name || "image"} is too big (${Math.round(NOTES_PASTE_IMAGE_MAX_BYTES / 1_048_576)} MB max).`;
  }
  return null;
}

/** POST one image to the local note media store; returns the URL to put in the image block. */
export async function uploadNotePasteImage(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const invalid = validateNotePasteImage(file);
  if (invalid) return { ok: false, error: invalid };

  const form = new FormData();
  form.append("file", file, file.name?.trim() || `paste.${extForNotePasteImage(file.type, file.name)}`);

  try {
    const res = await fetch("/api/notes-media", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok) {
      return { ok: false, error: body?.error?.trim() || `Upload failed (${res.status}).` };
    }
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) return { ok: false, error: "Upload returned no URL." };
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}
