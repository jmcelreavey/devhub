import fs from "node:fs";
import path from "node:path";

export function gitIndexLockPath(repoRoot: string): string {
  return path.join(repoRoot, ".git", "index.lock");
}

export function looksLikeIndexLockError(stderr: string, stdout = ""): boolean {
  const text = `${stderr}\n${stdout}`;
  return /index\.lock/i.test(text) || /could not write index/i.test(text);
}

export function formatIndexLockError(repoRoot: string, gitError?: string): string {
  const lockPath = gitIndexLockPath(repoRoot);
  const exists = fs.existsSync(lockPath);
  if (exists) {
    return (
      `Git index is locked (${lockPath}). Another git process may be running, ` +
      `or an interrupted command left the lock behind. DevHub will not remove it automatically. ` +
      `Verify no git process is using this repo, then remove the lock file manually and retry.`
    );
  }
  const trimmed = gitError?.trim();
  return trimmed || "Could not write git index";
}

/** Refuse index mutations while a lock exists; recovery is always manual. */
export function prepareGitIndexWrite(
  repoRoot: string,
): { ok: true } | { ok: false; error: string } {
  if (fs.existsSync(gitIndexLockPath(repoRoot))) {
    return { ok: false, error: formatIndexLockError(repoRoot) };
  }
  return { ok: true };
}
