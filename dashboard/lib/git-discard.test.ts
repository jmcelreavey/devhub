import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discardGitPaths } from "./git-discard";
import { runGitRepo } from "./git-repo-local";

function mkTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-discard-"));
  runGitRepo(dir, ["init", "-b", "main"]);
  runGitRepo(dir, ["config", "user.email", "test@example.com"]);
  runGitRepo(dir, ["config", "user.name", "Test"]);
  runGitRepo(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function write(repo: string, rel: string, content: string) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function setIndexBlob(repo: string, rel: string, content: string) {
  const tmp = path.join(repo, `.index-tmp-${Date.now()}`);
  fs.writeFileSync(tmp, content);
  const hashed = runGitRepo(repo, ["hash-object", "-w", tmp]);
  fs.unlinkSync(tmp);
  const oid = hashed.stdout.trim();
  runGitRepo(repo, ["update-index", "--cacheinfo", `100644,${oid},${rel}`]);
}

const repos: string[] = [];

afterEach(() => {
  for (const dir of repos.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("discardGitPaths", () => {
  it("discards staged hunks on a partially staged file without wiping unstaged", async () => {
    const repo = mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "line1\nline2\nline3\nline4\nline5\n");
    runGitRepo(repo, ["add", "file.txt"]);
    runGitRepo(repo, ["commit", "-m", "init"]);

    setIndexBlob(repo, "file.txt", "line1\nSTAGED\nline3\nline4\nline5\n");
    write(repo, "file.txt", "line1\nSTAGED\nline3\nUNSTAGED\nline5\n");

    expect(runGitRepo(repo, ["status", "--porcelain"]).stdout.trim()).toBe("MM file.txt");

    const result = await discardGitPaths(repo, ["file.txt"], "staged");
    expect(result.ok).toBe(true);

    const content = fs.readFileSync(path.join(repo, "file.txt"), "utf-8");
    expect(content).toBe("line1\nline2\nline3\nUNSTAGED\nline5\n");
    // Don't .trim() porcelain — leading space marks unstaged-only.
    expect(runGitRepo(repo, ["status", "--porcelain"]).stdout.replace(/\n$/, "")).toBe(" M file.txt");
    expect(runGitRepo(repo, ["diff", "--cached"]).stdout.trim()).toBe("");
  });

  it("discards unstaged only, keeping staged hunks", async () => {
    const repo = mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "a\nb\nc\n");
    runGitRepo(repo, ["add", "file.txt"]);
    runGitRepo(repo, ["commit", "-m", "init"]);

    setIndexBlob(repo, "file.txt", "a\nSTAGED\nc\n");
    write(repo, "file.txt", "a\nSTAGED\nUNSTAGED\n");

    const result = await discardGitPaths(repo, ["file.txt"], "unstaged");
    expect(result.ok).toBe(true);

    const content = fs.readFileSync(path.join(repo, "file.txt"), "utf-8");
    expect(content).toBe("a\nSTAGED\nc\n");
    expect(runGitRepo(repo, ["status", "--porcelain"]).stdout.trim()).toBe("M  file.txt");
  });

  it("discards fully staged file back to HEAD", async () => {
    const repo = mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "orig\n");
    runGitRepo(repo, ["add", "file.txt"]);
    runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.txt", "staged-only\n");
    runGitRepo(repo, ["add", "file.txt"]);

    const result = await discardGitPaths(repo, ["file.txt"], "staged");
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("orig\n");
    expect(runGitRepo(repo, ["status", "--porcelain"]).stdout.trim()).toBe("");
  });

  it("removes untracked on unstaged discard", async () => {
    const repo = mkTempRepo();
    repos.push(repo);
    runGitRepo(repo, ["commit", "--allow-empty", "-m", "init"]);
    write(repo, "junk.txt", "x\n");

    const result = await discardGitPaths(repo, ["junk.txt"], "unstaged");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(repo, "junk.txt"))).toBe(false);
  });

  it("removes newly staged file with no unstaged edits", async () => {
    const repo = mkTempRepo();
    repos.push(repo);
    runGitRepo(repo, ["commit", "--allow-empty", "-m", "init"]);
    write(repo, "new.txt", "hello\n");
    runGitRepo(repo, ["add", "new.txt"]);

    const result = await discardGitPaths(repo, ["new.txt"], "staged");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(repo, "new.txt"))).toBe(false);
  });
});
