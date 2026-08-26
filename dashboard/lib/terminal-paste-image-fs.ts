/**
 * Server-side temp writes for terminal dock image paste/drop.
 * Files land under os.tmpdir()/devhub-terminal-paste (override with
 * DEVHUB_TERMINAL_PASTE_DIR) — same machine as the PTY peer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TERMINAL_PASTE_IMAGE_MAX_BYTES,
  TERMINAL_PASTE_IMAGE_MAX_FILES,
} from "@/lib/terminal-paste-image";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function terminalPasteImageDir(): string {
  return process.env.DEVHUB_TERMINAL_PASTE_DIR || path.join(os.tmpdir(), "devhub-terminal-paste");
}

export function extForPasteImageMime(mime: string, name = ""): string {
  const type = mime.toLowerCase().trim();
  if (type === "image/jpeg") return "jpg";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  if (type === "image/png") return "png";
  const base = name.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "jpg";
    if (ext === "gif" || ext === "webp" || ext === "png") return ext;
  }
  return "png";
}

export function normalizePasteImageMime(mime: string, name = ""): string | null {
  const type = mime.toLowerCase().trim();
  if (ALLOWED_MIME.has(type)) return type;
  const ext = extForPasteImageMime(type, name);
  if (ext === "jpg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "png" && (type.startsWith("image/") || !type || type === "application/octet-stream")) {
    // Only accept octet-stream when the filename claims an image ext.
    if (!type || type === "application/octet-stream") {
      const base = name.trim().split(/[/\\]/).pop() ?? "";
      if (!/\.(png|jpe?g|gif|webp)$/i.test(base)) return null;
    }
    return "image/png";
  }
  return null;
}

export interface PasteImageWriteInput {
  bytes: Buffer;
  mime: string;
  name?: string;
}

/**
 * Write one or more images to the paste temp dir.
 * Returns absolute paths in write order.
 */
export async function writeTerminalPasteImages(
  inputs: PasteImageWriteInput[],
  opts?: { now?: number },
): Promise<string[]> {
  if (inputs.length === 0) throw new Error("No images to write.");
  if (inputs.length > TERMINAL_PASTE_IMAGE_MAX_FILES) {
    throw new Error(`Max ${TERMINAL_PASTE_IMAGE_MAX_FILES} images.`);
  }

  const dir = terminalPasteImageDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const ts = opts?.now ?? Date.now();
  const paths: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i]!;
    if (!item.bytes.length) throw new Error(`${item.name || "image"} is empty.`);
    if (item.bytes.length > TERMINAL_PASTE_IMAGE_MAX_BYTES) {
      throw new Error(
        `${item.name || "image"} is too big (${Math.round(TERMINAL_PASTE_IMAGE_MAX_BYTES / 1_048_576)} MB max).`,
      );
    }
    const mime = normalizePasteImageMime(item.mime, item.name);
    if (!mime) throw new Error(`${item.name || "file"} isn’t a supported image.`);
    const ext = extForPasteImageMime(mime, item.name);
    const filePath = path.join(dir, `devhub-terminal-paste-${ts}-${i}.${ext}`);
    await fs.promises.writeFile(filePath, item.bytes);
    paths.push(filePath);
  }

  return paths;
}
