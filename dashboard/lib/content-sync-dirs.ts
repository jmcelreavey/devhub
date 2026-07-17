/**
 * Server-side classification of the DevHub repo's personal-content paths
 * (notes / collections / tasks / upstarts / docs / diagrams). These sync via
 * the top-bar content-sync button, so the repo Git workspace and repo cards
 * must not count them as generic dirty files. Content dirs are resolved from
 * the CONFIGURED env-backed locations (TASKS_DIR etc.), not hardcoded
 * literals — relocating them is a supported setup per the personal-data
 * boundary in CONTRIBUTING.
 */
import path from "node:path";
import {
  getCollectionsDir,
  getDocsDir,
  getNotesDir,
  getRepoRoot,
  getTasksDir,
  getUpstartsDir,
} from "./notes-dir";
import { DIAGRAMS_DIR } from "./diagram-utils";

export type ContentBucket = "notes" | "tasks" | "docs" | "diagrams";

export interface ContentPrefix {
  bucket: ContentBucket;
  /** Repo-relative POSIX prefix (trailing slash). */
  prefix: string;
}

/** Repo-relative POSIX prefix (trailing slash) for a content dir, or null when it lives outside the repo. */
function repoRelativePrefix(root: string, dir: string): string | null {
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `${rel.split(path.sep).join("/")}/`;
}

function safeContentDir(resolve: () => string): string | null {
  try {
    return resolve();
  } catch {
    return null;
  }
}

/** True when a scanned repo path IS this DevHub checkout. */
export function isDevhubRepoRoot(repoRoot: string): boolean {
  try {
    return path.resolve(repoRoot) === path.resolve(getRepoRoot());
  } catch {
    return false;
  }
}

/**
 * Bucketed repo-relative content prefixes. Diagrams come first so a diagrams
 * dir nested under notes/ classifies as "diagrams", matching the top bar.
 */
export function buildContentBuckets(root: string): ContentPrefix[] {
  const buckets: ContentPrefix[] = [{ bucket: "diagrams", prefix: `${DIAGRAMS_DIR}/` }];
  const add = (bucket: ContentBucket, dir: string | null, fallback: string): void => {
    const prefix = dir ? repoRelativePrefix(root, dir) : `${fallback}/`;
    if (prefix) buckets.push({ bucket, prefix });
  };
  add("notes", safeContentDir(getNotesDir), "notes");
  add("notes", safeContentDir(getCollectionsDir), "collections");
  add("tasks", safeContentDir(getTasksDir), "tasks");
  add("tasks", safeContentDir(getUpstartsDir), "upstarts");
  add("docs", safeContentDir(getDocsDir), "docs");
  return buckets;
}

/** Bucket for a repo-relative file path, or null when it isn't synced content. */
export function matchContentBucket(
  buckets: ContentPrefix[],
  filePath: string,
): ContentBucket | null {
  return buckets.find((b) => filePath.startsWith(b.prefix))?.bucket ?? null;
}
