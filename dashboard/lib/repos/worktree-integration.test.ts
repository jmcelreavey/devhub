import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { isWorktreeIntegrated, loadDefaultBranch } from "./worktree-integration";

let root: string, remote: string, repo: string, linked: string;
const git = async (cwd: string, args: string[]) => (await execExternal("git", args, { cwd })).stdout.trim();
const commit = async (cwd: string, file: string, text: string) => {
  fs.writeFileSync(path.join(cwd, file), text);
  await git(cwd, ["add", file]);
  await git(cwd, ["-c", "commit.gpgsign=false", "commit", "-m", file]);
  return git(cwd, ["rev-parse", "HEAD"]);
};
beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-integration-")));
  remote = path.join(root, "remote"); repo = path.join(root, "clone"); linked = path.join(root, "feature");
  fs.mkdirSync(remote);
  await git(remote, ["init", "-b", "main"]);
  await git(remote, ["config", "user.name", "Test"]);
  await git(remote, ["config", "user.email", "test@example.com"]);
  await commit(remote, "shared.txt", "baseline\n");
  await git(root, ["clone", remote, repo]);
  await git(repo, ["config", "user.name", "Test"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["worktree", "add", "-b", "feature", linked]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("integrated worktree changes", () => {
  it.each(["squash", "rebase", "cherry-pick"])("recognises %s merges from the live default branch without changing the checkout", async (mode) => {
    const first = await commit(linked, "first.txt", "first\n");
    const head = await commit(linked, "second.txt", "second\n");
    const oldRemote = await git(repo, ["rev-parse", "origin/main"]);
    await commit(remote, "upstream.txt", "unrelated upstream change\n");
    await git(remote, ["fetch", repo, "feature"]);
    if (mode === "squash") {
      await git(remote, ["merge", "--squash", "FETCH_HEAD"]);
      await git(remote, ["-c", "commit.gpgsign=false", "commit", "-m", "squashed"]);
    } else if (mode === "rebase") {
      await git(remote, ["checkout", "-b", "rebased", "FETCH_HEAD"]);
      await git(remote, ["-c", "commit.gpgsign=false", "rebase", "main"]);
      await git(remote, ["checkout", "main"]);
      await git(remote, ["merge", "--ff-only", "rebased"]);
    } else {
      await git(remote, ["-c", "commit.gpgsign=false", "cherry-pick", first, head]);
    }
    const beforeIndex = fs.readFileSync(await git(linked, ["rev-parse", "--path-format=absolute", "--git-path", "index"]));
    const evidence = await loadDefaultBranch(repo, true);
    expect(evidence.defaultBranch?.head).toBe(await git(remote, ["rev-parse", "HEAD"]));
    expect(evidence.defaultBranch?.head).not.toBe(head);
    expect(await isWorktreeIntegrated(linked, head, evidence.defaultBranch!)).toBe(true);
    expect(await git(linked, ["rev-parse", "HEAD"])).toBe(head);
    expect(await git(repo, ["rev-parse", "origin/main"])).toBe(oldRemote);
    expect(fs.readFileSync(await git(linked, ["rev-parse", "--path-format=absolute", "--git-path", "index"]))).toEqual(beforeIndex);
    expect(await git(linked, ["status", "--porcelain"])).toBe("");

    const newer = await commit(linked, "keep.txt", "genuinely new work\n");
    expect(await isWorktreeIntegrated(linked, newer, evidence.defaultBranch!)).toBe(false);
    expect(fs.readFileSync(path.join(linked, "keep.txt"), "utf8")).toBe("genuinely new work\n");
  });

  it("rejects conflicting changes and custom drivers that can discard changes", async () => {
    const head = await commit(linked, "shared.txt", "local\n");
    await commit(remote, "shared.txt", "remote\n");
    const evidence = await loadDefaultBranch(repo, true);
    expect(await isWorktreeIntegrated(linked, head, evidence.defaultBranch!)).toBe(false);
    expect(fs.readFileSync(path.join(linked, "shared.txt"), "utf8")).toBe("local\n");
    expect(fs.existsSync(await git(linked, ["rev-parse", "--git-path", "MERGE_HEAD"]))).toBe(false);
    await git(repo, ["config", "merge.ours.driver", "true"]);
    expect(await isWorktreeIntegrated(repo, evidence.defaultBranch!.head, evidence.defaultBranch!)).toBe(false);
  });

  it("refreshes evidence for deletion and fails closed if the remote disappears", async () => {
    const initial = await loadDefaultBranch(repo, false);
    await commit(remote, "new.txt", "new upstream\n");
    expect((await loadDefaultBranch(repo, false)).defaultBranch?.head).toBe(initial.defaultBranch?.head);
    expect((await loadDefaultBranch(repo, true)).defaultBranch?.head).not.toBe(initial.defaultBranch?.head);
    await git(repo, ["remote", "remove", "origin"]);
    expect(await loadDefaultBranch(repo, true)).toMatchObject({ defaultBranchError: expect.any(String) });
    expect((await loadDefaultBranch(repo, true)).defaultBranch).toBeUndefined();
  });
});
