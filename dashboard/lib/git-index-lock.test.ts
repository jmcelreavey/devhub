import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  STALE_INDEX_LOCK_MS,
  clearStaleIndexLock,
  formatIndexLockError,
  gitIndexLockPath,
  looksLikeIndexLockError,
  prepareGitIndexWrite,
} from "./git-index-lock";

const tempRoots: string[] = [];

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-index-lock-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("looksLikeIndexLockError", () => {
  it("matches git's index.lock and could-not-write messages", () => {
    expect(
      looksLikeIndexLockError(
        "error: Unable to create '/tmp/repo/.git/index.lock': File exists.\nerror: could not write index",
      ),
    ).toBe(true);
    expect(looksLikeIndexLockError("conflict in foo.ts")).toBe(false);
  });
});

describe("clearStaleIndexLock / prepareGitIndexWrite", () => {
  it("is a no-op when no lock exists", () => {
    const root = makeRepo();
    expect(clearStaleIndexLock(root)).toEqual({
      cleared: false,
      lockPath: gitIndexLockPath(root),
    });
    expect(prepareGitIndexWrite(root)).toEqual({ ok: true, clearedStaleLock: false });
  });

  it("removes locks older than the stale threshold", () => {
    const root = makeRepo();
    const lockPath = gitIndexLockPath(root);
    fs.writeFileSync(lockPath, "");
    const staleMtime = Date.now() - STALE_INDEX_LOCK_MS - 1_000;
    fs.utimesSync(lockPath, staleMtime / 1000, staleMtime / 1000);

    const cleared = clearStaleIndexLock(root);
    expect(cleared.cleared).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("keeps fresh locks and returns a clear prepare error", () => {
    const root = makeRepo();
    const lockPath = gitIndexLockPath(root);
    fs.writeFileSync(lockPath, "");
    const now = Date.now();
    fs.utimesSync(lockPath, now / 1000, now / 1000);

    const cleared = clearStaleIndexLock(root, { now });
    expect(cleared.cleared).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);

    const prep = prepareGitIndexWrite(root, { now });
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(prep.error).toContain(lockPath);
      expect(prep.error).toMatch(/remove that file/i);
    }
  });
});

describe("formatIndexLockError", () => {
  it("mentions the lock path when present", () => {
    const root = makeRepo();
    fs.writeFileSync(gitIndexLockPath(root), "");
    expect(formatIndexLockError(root, "could not write index")).toContain(gitIndexLockPath(root));
  });
});
