/**
 * Client-safe helpers for pasting / dropping images into the terminal dock.
 * Writes go through `/api/terminal/paste-image`; this module only shapes
 * clipboard data and the PTY inject text.
 */

import { isImageAttach } from "@/lib/agent-attach";

export const TERMINAL_PASTE_IMAGE_MAX_BYTES = 8_000_000;
export const TERMINAL_PASTE_IMAGE_MAX_FILES = 8;

/** True when the File looks like a raster image the CLI can open. */
export function isTerminalPasteImageFile(file: File): boolean {
  return isImageAttach(file.type || "", file.name || "paste.png");
}

/**
 * Collect image files from a paste/drop DataTransfer.
 * Prefers `items` (macOS screenshot paste often skips `files`).
 */
export function collectTerminalPasteImageFiles(
  data: DataTransfer | null | undefined,
  max = TERMINAL_PASTE_IMAGE_MAX_FILES,
): File[] {
  if (!data || max <= 0) return [];
  const out: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null) => {
    if (!file || out.length >= max) return;
    if (!isTerminalPasteImageFile(file)) return;
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };

  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      push(item.getAsFile());
    }
  }

  if (out.length === 0 && data.files?.length) {
    for (const file of Array.from(data.files)) {
      push(file);
    }
  }

  return out;
}

/**
 * Shell-safe path list for PTY inject.
 * Space-separated absolute paths + trailing space so the user can keep typing.
 * Paths with whitespace are single-quoted (POSIX).
 */
export function formatTerminalImagePathInject(paths: string[]): string {
  const cleaned = paths.map((p) => p.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  const parts = cleaned.map((p) => (/\s/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p));
  return `${parts.join(" ")} `;
}

/** POST images to the temp-write API; returns absolute paths on success. */
export async function uploadTerminalPasteImages(
  files: File[],
): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> {
  const selected = files.slice(0, TERMINAL_PASTE_IMAGE_MAX_FILES);
  if (selected.length === 0) return { ok: false, error: "No images to upload." };

  for (const file of selected) {
    if (file.size <= 0) return { ok: false, error: `${file.name || "image"} is empty.` };
    if (file.size > TERMINAL_PASTE_IMAGE_MAX_BYTES) {
      return {
        ok: false,
        error: `${file.name || "image"} is too big (${Math.round(TERMINAL_PASTE_IMAGE_MAX_BYTES / 1_048_576)} MB max).`,
      };
    }
  }

  const form = new FormData();
  for (const file of selected) {
    const name = file.name?.trim() || `paste.${guessExt(file.type)}`;
    form.append("files", file, name);
  }

  try {
    const res = await fetch("/api/terminal/paste-image", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as
      | { paths?: string[]; error?: string }
      | null;
    if (!res.ok) {
      return { ok: false, error: body?.error?.trim() || `Upload failed (${res.status}).` };
    }
    const paths = Array.isArray(body?.paths)
      ? body.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    if (paths.length === 0) return { ok: false, error: "Upload returned no paths." };
    return { ok: true, paths };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}

function guessExt(mime: string): string {
  const type = mime.toLowerCase();
  if (type === "image/jpeg") return "jpg";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  return "png";
}
