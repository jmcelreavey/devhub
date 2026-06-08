import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execGh } from "@/lib/gh-exec";

/** A gist filename must be safe and end in `.md` so GitHub renders it. */
function gistFileName(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "note"}.md`;
}

/** First `https://gist.github.com/...` URL in `gh` output. */
function parseGistUrl(stdout: string): string | null {
  const match = stdout.match(/https:\/\/gist\.github\.com\/\S+/);
  return match ? match[0].trim() : null;
}

export interface CreatedGist {
  gistId: string;
  url: string;
}

/**
 * Create a secret gist from markdown. Secret gists are unlisted but readable by
 * anyone with the link — the intended "temp share" behaviour. Writes a temp
 * file because `gh gist create` reads content from a file path.
 */
export async function createGist(title: string, markdown: string): Promise<CreatedGist> {
  const dir = await mkdtemp(path.join(tmpdir(), "devhub-share-"));
  const filePath = path.join(dir, gistFileName(title));
  try {
    await writeFile(filePath, markdown, "utf-8");
    const { stdout } = await execGh([
      "gist",
      "create",
      filePath,
      "--desc",
      `${title} — shared from DevHub`,
    ]);
    const url = parseGistUrl(stdout);
    if (!url) {
      throw new Error("Could not parse gist URL from gh output");
    }
    const gistId = url.split("/").filter(Boolean).pop() ?? "";
    if (!gistId) {
      throw new Error("Could not parse gist id from gist URL");
    }
    return { gistId, url };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Overwrite an existing gist's single file with new markdown. */
export async function updateGist(gistId: string, title: string, markdown: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "devhub-share-"));
  const filePath = path.join(dir, gistFileName(title));
  try {
    await writeFile(filePath, markdown, "utf-8");
    await execGh(["gist", "edit", gistId, "--filename", gistFileName(title), filePath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Delete a gist. Tolerates an already-deleted gist (treated as success). */
export async function deleteGist(gistId: string): Promise<void> {
  try {
    await execGh(["gist", "delete", gistId, "--yes"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|404/i.test(message)) return;
    throw err;
  }
}
