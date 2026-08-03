import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneGitRevisionCache } from "./open-at-revision";

const CACHE_ROOT = path.join(os.homedir(), ".cache", "devhub", "git-revisions");
const REPO = "__prune-test-repo";
const repoPath = path.join(CACHE_ROOT, REPO);

function seedRevision(short: string, ageMs: number): string {
  const dir = path.join(repoPath, short);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "x.ts"), "cached");
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(dir, when, when);
  return dir;
}

describe("pruneGitRevisionCache", () => {
  beforeEach(() => fs.rmSync(repoPath, { recursive: true, force: true }));
  afterEach(() => fs.rmSync(repoPath, { recursive: true, force: true }));

  it("removes revisions older than the TTL and keeps fresh ones", () => {
    const stale = seedRevision("aaaaaaa", 48 * 60 * 60 * 1000);
    const fresh = seedRevision("bbbbbbb", 60 * 1000);

    pruneGitRevisionCache();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it("drops the repo folder once its last revision expires", () => {
    seedRevision("ccccccc", 48 * 60 * 60 * 1000);
    pruneGitRevisionCache();
    expect(fs.existsSync(repoPath)).toBe(false);
  });

  it("is a no-op when the cache has never been created", () => {
    expect(() => pruneGitRevisionCache()).not.toThrow();
  });

  it("honours an explicit clock and ttl", () => {
    const dir = seedRevision("ddddddd", 0);
    // Same directory, evaluated an hour into the future with a 1-minute TTL.
    expect(pruneGitRevisionCache(Date.now() + 3_600_000, 60_000)).toBeGreaterThan(0);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
