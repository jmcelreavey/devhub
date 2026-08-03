import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getCheckoutRoot, getRepoRoot } from "@/lib/content/dirs";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert";

const DRAFT_HEADER_START = "<!-- DEVHUB NOTE WORKING COPY";
const DRAFT_HEADER_END = "-->";

interface CursorDraftManifest {
  repoName: string;
  notePath: string;
  vaultKey: string;
  sourceHash: string;
  baseMarkdownHash: string;
  writable: boolean;
}

export interface CursorDraftResult {
  markdownPath: string;
  writable: boolean;
}

export interface ExistingCursorDraft {
  writable: boolean;
}

export class CursorDraftError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

function hash(value: unknown): string {
  const input = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\s*$/, "");
}

function vaultKey(vaultRoot: string): string {
  return hash(path.resolve(vaultRoot)).slice(0, 12);
}

function legacyDraftKey(repoName: string, notePath: string, vaultRoot: string): string {
  return hash(`${vaultKey(vaultRoot)}\0${repoName}\0${notePath}`).slice(0, 16);
}

function safeBaseName(notePath: string): string {
  return path.basename(notePath).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 64) || "note";
}

function safePathSegment(value: string): string {
  const result = value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 64) || "note";
  return result === "." || result === ".." ? "note" : result;
}

function draftFiles(repoName: string, notePath: string, rootDir: string) {
  const segments = notePath.split("/").filter(Boolean).map(safePathSegment);
  const noteFile = segments.pop() ?? "note";
  return {
    markdownPath: path.join(rootDir, safePathSegment(repoName), ...segments, `${noteFile}.md`),
    manifestPath: path.join(rootDir, safePathSegment(repoName), ...segments, `${noteFile}.json`),
  };
}

function legacyDraftFiles(repoName: string, notePath: string, vaultRoot: string, rootDir: string) {
  const key = legacyDraftKey(repoName, notePath, vaultRoot);
  return {
    markdownPath: path.join(rootDir, `${safeBaseName(notePath)}-${key}.md`),
    manifestPath: path.join(rootDir, `${key}.json`),
  };
}

function draftHeader(repoName: string, notePath: string, writable: boolean): string {
  const safePath = notePath.replaceAll("-->", "—>");
  return [
    DRAFT_HEADER_START,
    `Source note: ${safePath}`,
    `Code workspace: ${repoName}`,
    "",
    writable
      ? "This file is an editable Markdown projection of a DevHub note."
      : "This is a read-only projection because the note contains rich blocks that cannot safely round-trip through Markdown.",
    "Use the linked repository as code context. Never edit the JSON source.",
    writable
      ? 'Make requested changes here, keep this header, then choose "Apply Cursor changes" in DevHub.'
      : "Use this file for questions and review only; DevHub will not offer write-back.",
    DRAFT_HEADER_END,
    "",
  ].join("\n");
}

function stripDraftHeader(markdown: string): string {
  if (!markdown.startsWith(DRAFT_HEADER_START)) {
    throw new CursorDraftError("The Cursor working-copy header is missing. Reopen the note from DevHub.");
  }
  const end = markdown.indexOf(DRAFT_HEADER_END);
  if (end < 0) throw new CursorDraftError("The Cursor working-copy header is incomplete.");
  return markdown.slice(end + DRAFT_HEADER_END.length).replace(/^\r?\n+/, "");
}

function draftBody(markdown: string): string {
  // Older Cursor sessions can remove the instructional header; the manifest still
  // identifies the working copy, so retain the user's Markdown rather than losing it.
  return markdown.startsWith(DRAFT_HEADER_START) ? stripDraftHeader(markdown) : markdown;
}

function restoreDraftHeader(markdown: string, repoName: string, notePath: string, writable: boolean): string {
  if (markdown.startsWith(DRAFT_HEADER_START)) return markdown;
  return `${draftHeader(repoName, notePath, writable)}${markdown.replace(/^\r?\n+/, "")}`;
}

function readManifest(manifestPath: string): CursorDraftManifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CursorDraftManifest;
    if (
      !parsed.repoName ||
      !parsed.notePath ||
      !parsed.vaultKey ||
      !parsed.sourceHash ||
      !parsed.baseMarkdownHash ||
      typeof parsed.writable !== "boolean"
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePrivate(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* rename succeeded or the temporary write never completed */
    }
  }
}

function canonicalBlocks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalBlocks);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const isBlock = typeof record.type === "string" && ("props" in record || "children" in record);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "id" || !isBlock)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalBlocks(entry)]),
  );
}

function supportsLosslessWriteBack(content: unknown, markdown: string): boolean {
  const source = Array.isArray(content) ? content : [content];
  return JSON.stringify(canonicalBlocks(source)) === JSON.stringify(canonicalBlocks(textToBlocks(markdown)));
}

export function cursorDraftRoot(): string {
  return path.join(getCheckoutRoot() ?? getRepoRoot(), ".devhub", "cursor-notes");
}

function existingDraftFiles(
  repoName: string,
  notePath: string,
  vaultRoot: string,
  rootDir = cursorDraftRoot(),
): { markdownPath: string; manifestPath: string } | null {
  for (const files of [
    draftFiles(repoName, notePath, rootDir),
    legacyDraftFiles(repoName, notePath, vaultRoot, rootDir),
  ]) {
    if (fs.existsSync(files.markdownPath) && readManifest(files.manifestPath)) return files;
  }
  return null;
}

export function getCursorDraft(
  repoName: string,
  notePath: string,
  vaultRoot: string,
  rootDir = cursorDraftRoot(),
): ExistingCursorDraft | null {
  const files = existingDraftFiles(repoName, notePath, vaultRoot, rootDir);
  if (!files) return null;
  const manifest = readManifest(files.manifestPath);
  if (!manifest || manifest.repoName !== repoName || manifest.notePath !== notePath) return null;
  try {
    draftBody(fs.readFileSync(files.markdownPath, "utf8"));
    return { writable: manifest.writable };
  } catch {
    return null;
  }
}

export function createCursorDraft(
  repoName: string,
  notePath: string,
  content: unknown,
  vaultRoot: string,
  rootDir = cursorDraftRoot(),
): CursorDraftResult {
  fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(rootDir, 0o700);

  const files = draftFiles(repoName, notePath, rootDir);
  const sourceHash = hash(content);
  const existingFiles = existingDraftFiles(repoName, notePath, vaultRoot, rootDir);
  const existing = existingFiles && readManifest(existingFiles.manifestPath);

  if (existing && existingFiles) {
    const existingMarkdown = fs.readFileSync(existingFiles.markdownPath, "utf8");
    writePrivate(
      existingFiles.markdownPath,
      restoreDraftHeader(existingMarkdown, repoName, notePath, existing.writable),
    );
    return { markdownPath: existingFiles.markdownPath, writable: existing.writable };
  }

  fs.mkdirSync(path.dirname(files.markdownPath), { recursive: true, mode: 0o700 });
  const blocks = Array.isArray(content) ? content : [content];
  const markdown = normalizeMarkdown(blocksToText(blocks));
  const writable = supportsLosslessWriteBack(content, markdown);
  const manifest: CursorDraftManifest = {
    repoName,
    notePath,
    vaultKey: vaultKey(vaultRoot),
    sourceHash,
    baseMarkdownHash: hash(markdown),
    writable,
  };
  writePrivate(files.markdownPath, `${draftHeader(repoName, notePath, writable)}${markdown}\n`);
  writePrivate(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { markdownPath: files.markdownPath, writable };
}

export function applyCursorDraft(
  repoName: string,
  notePath: string,
  currentContent: unknown,
  vaultRoot: string,
  rootDir = cursorDraftRoot(),
): unknown[] {
  const files = existingDraftFiles(repoName, notePath, vaultRoot, rootDir);
  const manifest = files && readManifest(files.manifestPath);
  if (!files || !manifest) {
    throw new CursorDraftError("No Cursor working copy exists for this note.", 404);
  }
  if (manifest.repoName !== repoName || manifest.notePath !== notePath || manifest.vaultKey !== vaultKey(vaultRoot)) {
    throw new CursorDraftError("The Cursor working copy does not match this note.");
  }
  if (!manifest.writable) {
    throw new CursorDraftError("This note contains rich blocks that cannot safely round-trip through Markdown.", 409);
  }
  if (manifest.sourceHash !== hash(currentContent)) {
    throw new CursorDraftError(
      "The DevHub note changed after Cursor opened it. Reopen the note before applying changes.",
      409,
    );
  }

  const markdown = normalizeMarkdown(draftBody(fs.readFileSync(files.markdownPath, "utf8")));
  return textToBlocks(markdown);
}

export function markCursorDraftApplied(
  repoName: string,
  notePath: string,
  content: unknown,
  vaultRoot: string,
  rootDir = cursorDraftRoot(),
): void {
  const files = existingDraftFiles(repoName, notePath, vaultRoot, rootDir);
  const manifest = files && readManifest(files.manifestPath);
  if (!files || !manifest) return;
  const markdown = normalizeMarkdown(draftBody(fs.readFileSync(files.markdownPath, "utf8")));
  const nextManifest: CursorDraftManifest = {
    ...manifest,
    sourceHash: hash(content),
    baseMarkdownHash: hash(markdown),
  };
  writePrivate(files.manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
}

export function deleteCursorDraft(
  repoName: string,
  notePath: string,
  vaultRoot: string,
  rootDir = cursorDraftRoot(),
): boolean {
  const files = existingDraftFiles(repoName, notePath, vaultRoot, rootDir);
  if (!files) return false;
  let deleted = false;
  for (const filePath of [files.markdownPath, files.manifestPath]) {
    try {
      fs.unlinkSync(filePath);
      deleted = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return deleted;
}
