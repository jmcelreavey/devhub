import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { execExternal } from "../exec-external";
import { gitUnpushedCount } from "./git";

it("counts the current branch's unpublished commits and ignores deleted upstreams", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-unpushed-"));
  const git = (...args: string[]) => execExternal("git", args, { cwd, timeoutMs: 5000 });
  try {
    await git("init", "-b", "main");
    await git("config", "user.name", "DevHub test");
    await git("config", "user.email", "test@example.invalid");
    await git("config", "commit.gpgsign", "false");
    await git("commit", "--allow-empty", "-m", "initial");
    await git("remote", "add", "origin", cwd);
    await git("update-ref", "refs/remotes/origin/main", "HEAD");
    await git("branch", "--set-upstream-to=origin/main");
    expect(await gitUnpushedCount(cwd)).toBe(0);
    await git("commit", "--allow-empty", "-m", "local");
    expect(await gitUnpushedCount(cwd)).toBe(1);
    await git("branch", "other");
    await git("checkout", "--detach", "HEAD");
    expect(await gitUnpushedCount(cwd)).toBe(1);
    await git("checkout", "main");
    await git("update-ref", "-d", "refs/remotes/origin/main");
    expect(await gitUnpushedCount(cwd)).toBe(0);
    await git("branch", "--unset-upstream");
    expect(await gitUnpushedCount(cwd)).toBe(2);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}, 20_000);
