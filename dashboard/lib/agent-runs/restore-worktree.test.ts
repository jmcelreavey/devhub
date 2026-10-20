import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { ensureRunWorktree } from "./git";

let root: string;
let repo: string;
let worktree: string;
async function git(args: string[]) {
  return execExternal("git", args, { cwd: repo, timeoutMs: 10_000 });
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "restore-feedback-worktree-"));
  repo = path.join(root, "repo");
  worktree = path.join(root, "saved-work");
  fs.mkdirSync(repo);
  await git(["init", "-q"]);
  await git(["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "Fixture"]);
  await git(["branch", "feedback"]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("restoring feedback worktrees", () => {
  it("recreates a cleaned checkout on the existing branch without creating a new branch", async () => {
    const result = await ensureRunWorktree({ cwd: worktree, worktree: { path: worktree, repoRoot: repo, branch: "feedback" } });
    expect(fs.existsSync(path.join(result.cwd, ".git"))).toBe(true);
    expect((await execExternal("git", ["branch", "--show-current"], { cwd: result.cwd, timeoutMs: 10_000 })).stdout.trim()).toBe("feedback");
    const again = await ensureRunWorktree({ cwd: worktree, worktree: { path: worktree, repoRoot: repo, branch: "feedback" } });
    expect(fs.realpathSync(again.cwd)).toBe(fs.realpathSync(result.cwd));
    expect(again.worktree?.branch).toBe(result.worktree?.branch);
  });
  it("reuses an already-attached branch without overwriting either checkout", async () => {
    const other = path.join(root, "existing-work");
    await git(["worktree", "add", other, "feedback"]);
    const result = await ensureRunWorktree({ cwd: worktree, worktree: { path: worktree, repoRoot: repo, branch: "feedback" } });
    expect(fs.realpathSync(result.cwd)).toBe(fs.realpathSync(other));
    expect(fs.existsSync(worktree)).toBe(false);
    expect(result.worktree?.path).toBe(result.cwd);
  });
  it("refuses an occupied path or a deleted branch without changing the main checkout", async () => {
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, "keep.txt"), "Keep me");
    await expect(ensureRunWorktree({ cwd: worktree, worktree: { path: worktree, repoRoot: repo, branch: "feedback" } })).rejects.toThrow("occupied");
    expect(fs.readFileSync(path.join(worktree, "keep.txt"), "utf8")).toBe("Keep me");
    await expect(ensureRunWorktree({ cwd: path.join(root, "missing"), worktree: { path: path.join(root, "missing"), repoRoot: repo, branch: "deleted" } })).rejects.toThrow();
    expect((await git(["status", "--porcelain"])).stdout).toBe("");
  });
});
