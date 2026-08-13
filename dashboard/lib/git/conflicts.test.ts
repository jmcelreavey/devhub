import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectMarkerConflicts,
  readConflictSides,
  resolveConflictFile,
  resolveConflictSide,
} from "@/lib/git/conflicts";
import { parseConflictHunks, resolveConflictHunk } from "@/lib/git/conflict-markers";
import { runGitRepo } from "@/lib/git/repo-local";

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

  it("parses ordinary and diff3 markers and resolves one hunk", () => {
    const content =
      "before\n<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> branch\nafter\n";
    const hunks = parseConflictHunks(content);
    expect(hunks).toEqual([
      expect.objectContaining({ ours: "ours\n", base: "base\n", theirs: "theirs\n" }),
    ]);
    expect(resolveConflictHunk(content, hunks[0]!, "theirs")).toBe("before\ntheirs\nafter\n");
  });

  it("parses multiple marker blocks and ignores malformed ones", () => {
    const block = (ours: string, theirs: string) =>
      `<<<<<<< HEAD\n${ours}\n=======\n${theirs}\n>>>>>>> branch\n`;
    expect(parseConflictHunks(block("one", "two") + "middle\n" + block("three", "four"))).toHaveLength(2);
    expect(parseConflictHunks("<<<<<<< HEAD\nmissing separator\n>>>>>>> branch\n")).toEqual([]);
  });

  it("reads and resolves Git index stages", () => {
    const repo = mkTempRepo();
    repos.push(repo);
    fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
    runGitRepo(repo, ["add", "file.txt"]);
    runGitRepo(repo, ["commit", "-m", "base"]);
    runGitRepo(repo, ["checkout", "-b", "theirs"]);
    fs.writeFileSync(path.join(repo, "file.txt"), "theirs\n");
    runGitRepo(repo, ["commit", "-am", "theirs"]);
    runGitRepo(repo, ["checkout", "master"]);
    fs.writeFileSync(path.join(repo, "file.txt"), "ours\n");
    runGitRepo(repo, ["commit", "-am", "ours"]);
    expect(runGitRepo(repo, ["merge", "theirs"]).status).not.toBe(0);

    expect(readConflictSides(repo, "file.txt")).toMatchObject({
      base: "base\n",
      ours: "ours\n",
      theirs: "theirs\n",
      binary: false,
    });
    expect(resolveConflictSide(repo, "file.txt", "theirs")).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("theirs\n");
  });
});
