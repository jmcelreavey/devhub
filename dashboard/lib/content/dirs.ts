import path from "node:path";
import { resolveContentDir as resolveSharedContentDir } from "../../../shared/vault/content-dirs.ts";
import {
  getAppDataDir,
  getCheckoutRoot,
  getResourceRoot,
  isDesktopRuntime,
} from "@/lib/desktop/runtime-paths";

/**
 * The historical do-everything root.
 *
 * Kept because ~60 call sites use it, but its meaning is now narrowed: it is
 * the *content* base, i.e. the thing `NOTES_DIR` and friends default under. In
 * a checkout that is the checkout, unchanged. In the installed app it is the
 * writable app-data directory — never the read-only bundle, because callers
 * that reach `path.join(getRepoRoot(), "notes")` are trying to write.
 *
 * For packaged assets use `getResourceRoot()`; for "do I have a real git
 * checkout" use `getCheckoutRoot()`. Reaching for this function to answer
 * either of those questions is the bug this split exists to prevent.
 */
export function getRepoRoot(): string {
  if (isDesktopRuntime()) return getAppDataDir();
  const root = process.env.REPO_ROOT;
  if (!root) {
    // dashboard/lib/content/dirs.ts -> ../../.. -> repo root.
    // This depth is load-bearing: when this file lived at dashboard/lib/, it
    // was "../..". Moving it one level deeper silently repointed the repo root
    // at dashboard/, and sync_plugins started materialising the whole plugin
    // overlay into dashboard/dashboard/. Nothing typechecks this — if this file
    // ever moves again, count the levels by hand.
    return path.resolve(__dirname, "../../..");
  }
  return path.resolve(root);
}

export { getAppDataDir, getCheckoutRoot, getResourceRoot, isDesktopRuntime };

export function getHome(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }
  return home;
}

/** Env override, else `<content root>/<relativeSegment>`. */
export function resolveContentDir(envKey: string, relativeSegment: string): string {
  return resolveSharedContentDir(envKey, getRepoRoot(), relativeSegment);
}

/**
 * The notes vault.
 *
 * This used to throw when `NOTES_DIR` was unset while every sibling directory
 * quietly defaulted — an inconsistency that only held up because `postinstall`
 * writes `NOTES_DIR` into `.env.local`, so nothing ever hit the throw in
 * practice. It became load-bearing once call sites that had been building
 * `path.join(getRepoRoot(), "notes", …)` by hand were routed through here:
 * paths that had always resolved started throwing.
 *
 * Defaulting to `<content root>/notes` is both the documented behaviour and
 * exactly what those hand-built joins did.
 */
export function getNotesDir(): string {
  return resolveContentDir("NOTES_DIR", "notes");
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

/**
 * Per-repo Upstart scripts owned by the DevHub private mirror (not the target
 * project). Defaults to `REPO_ROOT/upstarts` when `UPSTARTS_DIR` is unset.
 */
export function getUpstartsDir(): string {
  return resolveContentDir("UPSTARTS_DIR", "upstarts");
}
