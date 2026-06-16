import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearRepoContextForTutorCache, getRepoContextForTutor } from "./repo-learn-tutor-context";

let tmpRoot: string | null = null;

function makeRepo(): string {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tutor-ctx-"));
  const repoPath = path.join(tmpRoot, "demo");
  fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoPath, "README.md"), "# Demo");
  return repoPath;
}

afterEach(() => {
  clearRepoContextForTutorCache();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("getRepoContextForTutor", () => {
  it("reuses cached context within TTL", async () => {
    const repoPath = makeRepo();
    const first = await getRepoContextForTutor(repoPath);
    const second = await getRepoContextForTutor(repoPath);
    expect(second).toBe(first);
  });
});
