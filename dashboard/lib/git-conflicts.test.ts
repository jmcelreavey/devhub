import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectMarkerConflicts, resolveConflictFile } from "./git-conflicts";
import { runGitRepo } from "./git-repo-local";

function mkTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-conflict-"));
  runGitRepo(dir, ["init"]);
  runGitRepo(dir, ["config", "user.email", "test@example.com"]);
  runGitRepo(dir, ["config", "user.name", "Test"]);
  return dir;
}

const repos: string[] = [];

afterEach(() => {
  for (const dir of repos.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("git-conflicts", () => {
  it("detects conflict markers in content sync paths", () => {
    const repo = mkTempRepo();
    repos.push(repo);
    const notePath = path.join(repo, "notes", "daily", "test.json");
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, '<<<<<<< HEAD\n{"a":1}\n=======\n{"b":2}\n>>>>>>> branch\n', "utf-8");
    const conflicts = detectMarkerConflicts(repo);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe("notes/daily/test.json");
  });

  it("resolveConflictFile rejects unresolved markers", () => {
    const repo = mkTempRepo();
    repos.push(repo);
    const result = resolveConflictFile(repo, "notes/foo.json", "<<<<<<< HEAD\nx\n>>>>>>> y\n");
    expect(result.ok).toBe(false);
  });
});
