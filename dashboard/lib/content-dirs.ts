import path from "node:path";
import { resolveContentDir as resolveSharedContentDir } from "../../shared/vault/content-dirs.ts";

export function getRepoRoot(): string {
  const root = process.env.REPO_ROOT;
  if (!root) {
    return path.resolve(__dirname, "../..");
  }
  return path.resolve(root);
}

export function getHome(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }
  return home;
}

function requireContentDir(envKey: string): string {
  const dir = process.env[envKey];
  if (!dir) {
    throw new Error(`${envKey} environment variable is not set`);
  }
  return path.resolve(dir);
}

/** Env override, else `REPO_ROOT/<relativeSegment>`. */
export function resolveContentDir(envKey: string, relativeSegment: string): string {
  return resolveSharedContentDir(envKey, getRepoRoot(), relativeSegment);
}

export function getNotesDir(): string {
  return requireContentDir("NOTES_DIR");
}

/** Repo documentation tree; defaults to `REPO_ROOT/docs` when `DOCS_DIR` is unset. */
export function getDocsDir(): string {
  return resolveContentDir("DOCS_DIR", "docs");
}

/**
 * Personal daily tasks; defaults to `REPO_ROOT/tasks` when `TASKS_DIR` is unset.
 * Point it elsewhere (e.g. a separate private repo) to keep personal data out of the
 * shared tree — see the personal-data boundary in CONTRIBUTING.md.
 */
export function getTasksDir(): string {
  return resolveContentDir("TASKS_DIR", "tasks");
}

/** Checklist collections; defaults to `REPO_ROOT/collections` when `COLLECTIONS_DIR` is unset. */
export function getCollectionsDir(): string {
  return resolveContentDir("COLLECTIONS_DIR", "collections");
}
