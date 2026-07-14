// Share the bespoke briefing as a viewable web page.
//
// Mirrors the notes sharing flow (lib/share): publish a SECRET GitHub gist via
// the gh CLI. Notes share markdown (GitHub renders .md); the briefing is a full
// HTML document, so we publish briefing.html and hand back a gistpreview.github.io
// URL that renders it. The snapshot has data baked in (window.__BRIEFING__), so
// it renders standalone off-origin. Secret gists are unlisted but readable by
// anyone with the link.

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execGh } from "@/lib/gh-exec";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import { buildBriefingContext } from "@/lib/briefing-context";
import { readCanvas, renderCanvasDocument } from "@/lib/briefing-canvas";
import type { CanvasTheme } from "@/lib/briefing-theme";

const SHARE_VERSION = 1;
const FILENAME = "briefing.html";

export interface ShareRecord {
  version: number;
  gistId: string;
  gistUrl: string;
  viewUrl: string;
  updatedAt: string;
}

function shareFile(): string {
  return path.join(getRepoRoot(), "notes", ".config", "briefing-share.json");
}

export function readShare(): ShareRecord | null {
  const s = safeReadJSON<ShareRecord | null>(shareFile(), null);
  return s && s.gistId ? s : null;
}

async function writeShare(rec: ShareRecord | null): Promise<void> {
  const file = shareFile();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify(rec ?? { version: SHARE_VERSION }, null, 2));
  });
}

function parseGistUrl(stdout: string): string | null {
  const m = stdout.match(/https:\/\/gist\.github\.com\/\S+/);
  return m ? m[0].trim() : null;
}

function viewUrlFor(gistId: string): string {
  return `https://gistpreview.github.io/?${gistId}/${FILENAME}`;
}

function isNotFound(err: unknown): boolean {
  return /not found|404/i.test(err instanceof Error ? err.message : String(err));
}

async function renderSnapshot(theme?: CanvasTheme | null): Promise<string> {
  const context = await buildBriefingContext();
  const canvas = readCanvas();
  return renderCanvasDocument(canvas.html, context, theme ?? null);
}

async function withTempFile<T>(html: string, fn: (filePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "devhub-brief-share-"));
  const filePath = path.join(dir, FILENAME);
  try {
    await writeFile(filePath, html, "utf-8");
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function createHtmlGist(html: string): Promise<{ gistId: string; gistUrl: string }> {
  return withTempFile(html, async (filePath) => {
    const { stdout } = await execGh(["gist", "create", filePath, "--desc", "DevHub daily briefing - shared snapshot"]);
    const gistUrl = parseGistUrl(stdout);
    if (!gistUrl) throw new Error("Could not parse gist URL from gh output");
    const gistId = gistUrl.split("/").filter(Boolean).pop() ?? "";
    if (!gistId) throw new Error("Could not parse gist id from gist URL");
    return { gistId, gistUrl };
  });
}

async function updateHtmlGist(gistId: string, html: string): Promise<void> {
  return withTempFile(html, async (filePath) => {
    await execGh(["gist", "edit", gistId, "--filename", FILENAME, filePath]);
  });
}

/** Publish (or update) the current canvas as a shareable, rendered gist. */
export async function publishShare(theme?: CanvasTheme | null): Promise<ShareRecord> {
  const html = await renderSnapshot(theme);
  const existing = readShare();

  if (existing) {
    try {
      await updateHtmlGist(existing.gistId, html);
      const rec: ShareRecord = { ...existing, viewUrl: viewUrlFor(existing.gistId), updatedAt: new Date().toISOString() };
      await writeShare(rec);
      return rec;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // The stored gist was deleted upstream; fall through and create a fresh one.
    }
  }

  const { gistId, gistUrl } = await createHtmlGist(html);
  const rec: ShareRecord = {
    version: SHARE_VERSION,
    gistId,
    gistUrl,
    viewUrl: viewUrlFor(gistId),
    updatedAt: new Date().toISOString(),
  };
  await writeShare(rec);
  return rec;
}

/** Delete the shared gist and forget it. */
export async function unpublishShare(): Promise<boolean> {
  const existing = readShare();
  if (!existing) return false;
  try {
    await execGh(["gist", "delete", existing.gistId, "--yes"]);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  await writeShare(null);
  return true;
}
