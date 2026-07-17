import fs from "node:fs";
import path from "node:path";

/** Locks older than this are treated as leftovers from a crashed/interrupted git. */
export const STALE_INDEX_LOCK_MS = 5 * 60 * 1000;

export function gitIndexLockPath(repoRoot: string): string {
  return path.join(repoRoot, ".git", "index.lock");
}

export function looksLikeIndexLockError(stderr: string, stdout = ""): boolean {
  const text = `${stderr}\n${stdout}`;
  return /index\.lock/i.test(text) || /could not write index/i.test(text);
}

/**
 * Remove `.git/index.lock` when it is clearly stale.
 * Fresh locks are left alone — another git process may still own them.
 */
export function clearStaleIndexLock(
  repoRoot: string,
  opts?: { maxAgeMs?: number; now?: number },
): { cleared: boolean; ageMs?: number; lockPath: string } {
  const lockPath = gitIndexLockPath(repoRoot);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch {
    return { cleared: false, lockPath };
  }

  const now = opts?.now ?? Date.now();
  const ageMs = Math.max(0, now - mtimeMs);
  const maxAgeMs = opts?.maxAgeMs ?? STALE_INDEX_LOCK_MS;
  if (ageMs < maxAgeMs) {
    return { cleared: false, ageMs, lockPath };
  }

  try {
    fs.unlinkSync(lockPath);
    return { cleared: true, ageMs, lockPath };
  } catch {
    return { cleared: false, ageMs, lockPath };
  }
}

export function formatIndexLockError(repoRoot: string, gitError?: string): string {
  const lockPath = gitIndexLockPath(repoRoot);
  const exists = fs.existsSync(lockPath);
  if (exists) {
    return (
      `Git index is locked (${lockPath}). Another git process may be running, ` +
      `or a stale lock was left behind. If nothing else is using this repo, remove that file and retry.`
    );
  }
  const trimmed = gitError?.trim();
  return trimmed || "Could not write git index";
}

/**
 * Ensure the index is writable before stash/checkout/stage mutations.
 * Clears stale locks; returns a clear error if a fresh lock remains.
 */
export function prepareGitIndexWrite(
  repoRoot: string,
  opts?: { maxAgeMs?: number; now?: number },
): { ok: true; clearedStaleLock: boolean } | { ok: false; error: string } {
  const before = clearStaleIndexLock(repoRoot, opts);
  if (before.cleared) {
    return { ok: true, clearedStaleLock: true };
  }
  if (before.ageMs !== undefined && fs.existsSync(before.lockPath)) {
    return { ok: false, error: formatIndexLockError(repoRoot) };
  }
  return { ok: true, clearedStaleLock: false };
}
