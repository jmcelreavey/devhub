import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getGithubFullNameForLocalRepo } from "@/lib/repos";
import { readOriginRemoteUrl } from "@/lib/git/repo-local";

/**
 * A worktree's `.git` is a *file* pointing at a gitdir under the main
 * repository, not a directory. Everything that read `<repo>/.git/HEAD` or
 * `<repo>/.git/config` directly therefore failed on one, and the failure was
 * silent: the repo list showed a worktree as a detached-HEAD checkout with no
 * remote and a bad health score, which is both wrong and alarming.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** A repo with a remote and one worktree on a second branch. */
function repoWithWorktree(): { repo: string; worktree: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-wt-scan-"));
  dirs.push(base);
  const repo = path.join(base, "main-repo");
  fs.mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t.com"]);
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["remote", "add", "origin", "git@github.com:acme/thing.git"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-m", "init"]);

  const worktree = path.join(base, "main-repo--side");
  git(repo, ["worktree", "add", "-b", "side/work", worktree]);
  return { repo, worktree };
}

describe("scanning a worktree", () => {
  it("resolves the remote through the shared common dir", () => {
    // The worktree's own gitdir has no config — it shares the main repo's.
    const { repo, worktree } = repoWithWorktree();
    expect(readOriginRemoteUrl(repo)).toBe("git@github.com:acme/thing.git");
    expect(readOriginRemoteUrl(worktree)).toBe("git@github.com:acme/thing.git");
  });

  it("derives the GitHub full name for a worktree", () => {
    // Without this a worktree got no PR status and no avatars, because every
    // GitHub lookup starts from the remote.
    const { worktree } = repoWithWorktree();
    expect(getGithubFullNameForLocalRepo(worktree)).toBe("acme/thing");
  });

  it("returns null for a directory that is not a repo at all", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-wt-none-"));
    dirs.push(base);
    expect(readOriginRemoteUrl(base)).toBeNull();
    expect(getGithubFullNameForLocalRepo(base)).toBeNull();
  });

  it("survives a .git file pointing somewhere that no longer exists", () => {
    // A worktree whose main repo was deleted; it should read as unknown rather
    // than throwing out of the repo scan.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-wt-dangling-"));
    dirs.push(base);
    fs.writeFileSync(path.join(base, ".git"), "gitdir: /nowhere/at/all/.git/worktrees/x\n");
    expect(readOriginRemoteUrl(base)).toBeNull();
  });
});
