/**
 * Client-safe Agent chat attachments.
 * No Node builtins — imported by the webpack client.
 */

export const AGENT_ATTACH_MAX_BYTES = 1_500_000;
export const AGENT_ATTACH_MAX_FILES = 8;
export const AGENT_ATTACH_TEXT_MAX_CHARS = 80_000;

const TEXT_EXT = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "rb",
  "java",
  "kt",
  "swift",
  "css",
  "scss",
  "html",
  "htm",
  "xml",
  "yml",
  "yaml",
  "toml",
  "sh",
  "bash",
  "zsh",
  "env",
  "csv",
  "svg",
  "sql",
  "graphql",
  "proto",
  "dockerfile",
  "gitignore",
  "editorconfig",
]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type AgentAttachRejectReason = "too-large" | "empty" | "unsupported" | "binary" | "too-many";

export interface AgentAttachReject {
  name: string;
  reason: AgentAttachRejectReason;
}

export interface AgentPreparedAttachment {
  id: string;
  name: string;
  size: number;
  kind: "text" | "image";
  mime: string;
  text?: string;
  dataUrl?: string;
}

export interface AgentAttachPayload {
  name: string;
  kind: "text" | "image";
  mime?: string;
  text?: string;
  dataUrl?: string;
}

export function fileExt(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base.toLowerCase();
  return base.slice(dot + 1).toLowerCase();
}

export function formatAttachSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104_857.6) / 10} MB`;
}

export function rejectAttachMessage(reject: AgentAttachReject): string {
  switch (reject.reason) {
    case "too-large":
      return `${reject.name} is too big (${formatAttachSize(AGENT_ATTACH_MAX_BYTES)} max).`;
    case "empty":
      return `${reject.name} is empty.`;
    case "binary":
      return `${reject.name} isn’t text or an image.`;
    case "too-many":
      return `Max ${AGENT_ATTACH_MAX_FILES} files.`;
    default:
      return `${reject.name} isn’t a supported type.`;
  }
}

export function isImageAttach(mime: string, name: string): boolean {
  const type = mime.toLowerCase();
  if (IMAGE_MIME.has(type)) return true;
  return IMAGE_EXT.has(fileExt(name));
}

export function isTextAttach(mime: string, name: string): boolean {
  const type = mime.toLowerCase();
  if (type.startsWith("text/")) return true;
  if (type === "application/json" || type === "application/javascript" || type === "image/svg+xml") {
    return true;
  }
  const ext = fileExt(name);
  if (TEXT_EXT.has(ext)) return true;
  if (name.toLowerCase() === "dockerfile" || name.toLowerCase() === "makefile") return true;
  return false;
}

/** NUL or a high replacement-character ratio means this isn’t text we should inline. */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  let nuls = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) nuls += 1;
  }
  if (nuls > 0) return true;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  if (!decoded) return true;
  let replacement = 0;
  for (const ch of decoded) {
    if (ch === "\uFFFD") replacement += 1;
  }
  return replacement / decoded.length > 0.1;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "");
}

export function classifyAgentBytes(opts: {
  name: string;
  mime?: string;
  size: number;
  bytes: Uint8Array;
}):
  | { kind: "text"; text: string; mime: string }
  | { kind: "image"; mime: string }
  | { kind: "rejected"; reason: AgentAttachRejectReason } {
  const mime = (opts.mime || "").trim() || "application/octet-stream";
  if (opts.size <= 0 || opts.bytes.length === 0) return { kind: "rejected", reason: "empty" };
  if (opts.size > AGENT_ATTACH_MAX_BYTES || opts.bytes.length > AGENT_ATTACH_MAX_BYTES) {
    return { kind: "rejected", reason: "too-large" };
  }
  if (isImageAttach(mime, opts.name)) {
    return { kind: "image", mime: IMAGE_MIME.has(mime.toLowerCase()) ? mime.toLowerCase() : guessImageMime(opts.name) };
  }
  if (isProbablyBinary(opts.bytes) && !isTextAttach(mime, opts.name)) {
    return { kind: "rejected", reason: "binary" };
  }
  if (isTextAttach(mime, opts.name) || !isProbablyBinary(opts.bytes)) {
    if (isProbablyBinary(opts.bytes) && !isTextAttach(mime, opts.name)) {
      return { kind: "rejected", reason: "binary" };
    }
    const text = decodeUtf8(opts.bytes);
    if (!text.trim()) return { kind: "rejected", reason: "empty" };
    return {
      kind: "text",
      mime: mime.startsWith("text/") ? mime : "text/plain",
      text: text.length > AGENT_ATTACH_TEXT_MAX_CHARS ? `${text.slice(0, AGENT_ATTACH_TEXT_MAX_CHARS)}\n\n[truncated]` : text,
    };
  }
  return { kind: "rejected", reason: "unsupported" };
}

export function guessImageMime(name: string): string {
  const ext = fileExt(name);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8_000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  return `data:${mime};base64,${b64}`;
}

function newAttachId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export async function prepareAgentFiles(
  files: File[],
  already = 0,
): Promise<{ ok: AgentPreparedAttachment[]; rejected: AgentAttachReject[] }> {
  const ok: AgentPreparedAttachment[] = [];
  const rejected: AgentAttachReject[] = [];
  for (const file of files) {
    if (already + ok.length >= AGENT_ATTACH_MAX_FILES) {
      rejected.push({ name: file.name || "file", reason: "too-many" });
      continue;
    }
    const bytes = await readFileBytes(file);
    const classified = classifyAgentBytes({
      name: file.name || "file",
      mime: file.type,
      size: file.size,
      bytes,
    });
    if (classified.kind === "rejected") {
      rejected.push({ name: file.name || "file", reason: classified.reason });
      continue;
    }
    if (classified.kind === "text") {
      ok.push({
        id: newAttachId(),
        name: file.name || "file",
        size: file.size,
        kind: "text",
        mime: classified.mime,
        text: classified.text,
      });
      continue;
    }
    ok.push({
      id: newAttachId(),
      name: file.name || "file",
      size: file.size,
      kind: "image",
      mime: classified.mime,
      dataUrl: bytesToDataUrl(bytes, classified.mime),
    });
  }
  return { ok, rejected };
}

export function parseAgentAttachPayload(raw: unknown): AgentAttachPayload[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAttachPayload[] = [];
  for (const item of raw.slice(0, AGENT_ATTACH_MAX_FILES)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Partial<AgentAttachPayload>;
    if (typeof rec.name !== "string" || !rec.name.trim()) continue;
    if (rec.kind === "text" && typeof rec.text === "string" && rec.text.trim()) {
      out.push({
        name: rec.name.trim().slice(0, 180),
        kind: "text",
        mime: typeof rec.mime === "string" ? rec.mime : "text/plain",
        text: rec.text.slice(0, AGENT_ATTACH_TEXT_MAX_CHARS),
      });
      continue;
    }
    if (
      rec.kind === "image" &&
      typeof rec.dataUrl === "string" &&
      rec.dataUrl.startsWith("data:image/") &&
      rec.dataUrl.length <= AGENT_ATTACH_MAX_BYTES * 2
    ) {
      out.push({
        name: rec.name.trim().slice(0, 180),
        kind: "image",
        mime: typeof rec.mime === "string" ? rec.mime : "image/png",
        dataUrl: rec.dataUrl,
      });
    }
  }
  return out;
}

export function cliCannotUseImages(provider?: string | null): boolean {
  const id = (provider || "").trim().toLowerCase();
  return id === "cursor" || id === "cursor-cli" || id === "opencode" || id === "chatgpt" || id === "chatgpt-cli";
}

/**
 * Fold attachments into the user prompt.
 * Images stay out of the CLI prompt; callers pass them separately for the HTTP API.
 */
export function mergeAttachmentsIntoPrompt(opts: {
  text: string;
  attachments: AgentAttachPayload[];
  imageMode: "api" | "cli";
}): { prompt: string; images: { name: string; dataUrl: string }[]; skippedImages: string[] } {
  const body = opts.text.trim();
  const chunks: string[] = body ? [body] : [];
  const images: { name: string; dataUrl: string }[] = [];
  const skippedImages: string[] = [];

  for (const att of opts.attachments) {
    if (att.kind === "text" && att.text?.trim()) {
      const lang = fileExt(att.name).replace(/[^a-z0-9]/g, "") || "text";
      chunks.push(`Attached ${att.name}:\n\`\`\`${lang}\n${att.text.trimEnd()}\n\`\`\``);
      continue;
    }
    if (att.kind === "image" && att.dataUrl) {
      if (opts.imageMode === "api") {
        images.push({ name: att.name, dataUrl: att.dataUrl });
        chunks.push(`Attached image: ${att.name}`);
      } else {
        skippedImages.push(att.name);
      }
    }
  }

  if (skippedImages.length > 0) {
    chunks.push(
      `Images not sent (${skippedImages.join(", ")}). ChatGPT/API can use images; Cursor CLI print may not.`,
    );
  }

  return {
    prompt: chunks.join("\n\n") || "Hello",
    images,
    skippedImages,
  };
}
