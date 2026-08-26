/**
 * Client-safe helpers for pasting / dropping images into the notes editor.
 * Writes go through `POST /api/notes-assets`; this module shapes paths and FormData.
 */

import { isImageAttach } from "@/lib/agent-attach";
import { toNoteAssetApiUrl } from "@/lib/notes-assets/markdown";
import { NOTE_ASSET_DIR_NAME } from "@/lib/notes/tree-sidebar-filter";

export const NOTES_PASTE_IMAGE_MAX_BYTES = 8_000_000;

const PASTE_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** True when the File is a raster image we store under notes assets. */
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

/**
 * Notes-relative asset path for a paste into `notePath` (slug without `.json`).
 * Uses the per-note wrapper folder convention: `{noteSlug}/assets/...`.
 */
export function buildNotePasteAssetRelPath(
  notePath: string,
  opts: { ext: string; name?: string; now?: number; index?: number },
): string {
  const slug = notePath
    .replace(/\\/g, "/")
    .replace(/\.json$/i, "")
    .split("/")
    .filter(Boolean)
    .filter((part) => part !== "." && part !== "..")
    .join("/");
  if (!slug) throw new Error("Note path is required");

  const ext = opts.ext.replace(/^\./, "").toLowerCase();
  if (!PASTE_IMAGE_EXTS.has(ext === "jpeg" ? "jpg" : ext)) {
    throw new Error(`Unsupported image type .${ext}`);
  }
  const safeExt = ext === "jpeg" ? "jpg" : ext;
  const ts = opts.now ?? Date.now();
  const index = opts.index ?? 0;
  const stem = sanitizePasteBasename(opts.name) || "paste";
  const file = `${stem}-${ts}${index > 0 ? `-${index}` : ""}.${safeExt}`;
  return `${slug}/${NOTE_ASSET_DIR_NAME}/${file}`;
}

/** Strip path junk and keep a filesystem-friendly basename stem (no extension). */
export function sanitizePasteBasename(name?: string): string | null {
  if (!name?.trim()) return null;
  const base = name.trim().split(/[/\\]/).pop() ?? "";
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!cleaned || cleaned === "image" || cleaned === "paste") return null;
  return cleaned.slice(0, 48);
}

/** POST one image into the notes vault next to `notePath`; returns the BlockNote URL. */
export async function uploadNotePasteImage(
  file: File,
  notePath: string,
): Promise<{ ok: true; path: string; url: string } | { ok: false; error: string }> {
  if (!notePath.trim()) return { ok: false, error: "Save the note before pasting images." };
  if (!isNotePasteImageFile(file)) {
    return { ok: false, error: `${file.name || "file"} isn’t a supported image.` };
  }
  if (file.size <= 0) return { ok: false, error: `${file.name || "image"} is empty.` };
  if (file.size > NOTES_PASTE_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `${file.name || "image"} is too big (${Math.round(NOTES_PASTE_IMAGE_MAX_BYTES / 1_048_576)} MB max).`,
    };
  }

  const form = new FormData();
  form.append("notePath", notePath.trim());
  const name = file.name?.trim() || `paste.${extForNotePasteImage(file.type, file.name)}`;
  form.append("file", file, name);

  try {
    const res = await fetch("/api/notes-assets", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as
      | { path?: string; url?: string; error?: string }
      | null;
    if (!res.ok) {
      return { ok: false, error: body?.error?.trim() || `Upload failed (${res.status}).` };
    }
    const path = typeof body?.path === "string" ? body.path.trim() : "";
    if (!path) return { ok: false, error: "Upload returned no path." };
    const url =
      typeof body?.url === "string" && body.url.trim()
        ? body.url.trim()
        : toNoteAssetApiUrl(path);
    return { ok: true, path, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}
