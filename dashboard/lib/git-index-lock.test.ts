import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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

describe("prepareGitIndexWrite", () => {
  it("is a no-op when no lock exists", () => {
    const root = makeRepo();
    expect(prepareGitIndexWrite(root)).toEqual({ ok: true });
  });

  it("never removes an old lock and returns manual recovery guidance", () => {
    const root = makeRepo();
    const lockPath = gitIndexLockPath(root);
    fs.writeFileSync(lockPath, "");
    const staleMtime = Date.now() - 24 * 60 * 60 * 1_000;
    fs.utimesSync(lockPath, staleMtime / 1000, staleMtime / 1000);

    const prep = prepareGitIndexWrite(root);
    expect(prep.ok).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
    if (!prep.ok) {
      expect(prep.error).toContain(lockPath);
      expect(prep.error).toMatch(/will not remove it automatically/i);
      expect(prep.error).toMatch(/remove the lock file manually/i);
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
