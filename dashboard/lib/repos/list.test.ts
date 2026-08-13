import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareReposByMtime, repoMtimeMs } from "@/lib/repos";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-mtime-"));
  dirs.push(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t.com"]);
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}

describe("compareReposByMtime", () => {
  it("orders newest first", () => {
    const repos = [
      { name: "alpha", mtimeMs: 100 },
      { name: "zeta", mtimeMs: 300 },
      { name: "beta", mtimeMs: 200 },
    ];
    expect([...repos].sort(compareReposByMtime).map((r) => r.name)).toEqual(["zeta", "beta", "alpha"]);
  });

  it("breaks ties alphabetically", () => {
    const repos = [
      { name: "zeta", mtimeMs: 100 },
      { name: "alpha", mtimeMs: 100 },
    ];
    expect([...repos].sort(compareReposByMtime).map((r) => r.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("repoMtimeMs", () => {
  it("reads .git/logs/HEAD mtime", () => {
    const repo = initRepo();
    const headLog = path.join(repo, ".git", "logs", "HEAD");
    const when = new Date("2021-06-15T12:00:00Z");
    fs.utimesSync(headLog, when, when);
    expect(Math.abs(repoMtimeMs(repo) - when.getTime())).toBeLessThan(2000);
  });

  it("falls back to the clone path when HEAD log is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-mtime-bare-"));
    dirs.push(dir);
    const when = new Date("2019-03-01T00:00:00Z");
    fs.utimesSync(dir, when, when);
    expect(Math.abs(repoMtimeMs(dir) - when.getTime())).toBeLessThan(2000);
  });

  it("uses the worktree gitdir HEAD log, not the main repo's", () => {
    const repo = initRepo();
    const worktree = path.join(path.dirname(repo), `${path.basename(repo)}--side`);
    dirs.push(worktree);
    git(repo, ["worktree", "add", "-b", "side/work", worktree]);

    const mainLog = path.join(repo, ".git", "logs", "HEAD");
    const pointer = fs.readFileSync(path.join(worktree, ".git"), "utf-8").trim();
    const match = /^gitdir:\s*(.+)$/m.exec(pointer);
    if (!match?.[1]) throw new Error("expected worktree gitdir pointer");
    const worktreeLog = path.join(match[1].trim(), "logs", "HEAD");

    const mainWhen = new Date("2018-01-01T00:00:00Z");
    const worktreeWhen = new Date("2022-08-01T00:00:00Z");
    fs.utimesSync(mainLog, mainWhen, mainWhen);
    fs.utimesSync(worktreeLog, worktreeWhen, worktreeWhen);

    expect(Math.abs(repoMtimeMs(worktree) - worktreeWhen.getTime())).toBeLessThan(2000);
    expect(Math.abs(repoMtimeMs(repo) - mainWhen.getTime())).toBeLessThan(2000);
  });
});
