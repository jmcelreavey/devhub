import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { fetchHandoffWorktree, inspectHandoffGit, normaliseGitOrigin, pushHandoffBranch, validateHandoffBranch } from "./git";

let root: string;
let checkout: string;
let remote: string;
async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execExternal("git", args, { cwd, timeoutMs: 20000 })).stdout.trim();
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "team-handoff-git-"));
  checkout = path.join(root, "owner"); remote = path.join(root, "remote.git");
  await fs.mkdir(checkout);
  await git(root, "init", "--bare", remote);
  await git(checkout, "init", "--initial-branch=main");
  await git(checkout, "config", "user.name", "Local test"); await git(checkout, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(checkout, "task.txt"), "initial\n"); await git(checkout, "add", "task.txt"); await git(checkout, "commit", "-m", "Initial fixture");
  await git(checkout, "remote", "add", "origin", remote); await git(checkout, "push", "origin", "main");
  await git(checkout, "checkout", "-b", "feature/task");
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
describe("handoff git guards", () => {
  it("fetches into an isolated, retry-safe worktree on the owner's branch without touching the receiver checkout", async () => {
    vi.stubEnv("DEVHUB_REPOS_DIR", root);
    await pushHandoffBranch(await inspectHandoffGit(checkout, "feature/task"), "helper", false);
    const receiver = path.join(root, "receiver"); await git(root, "clone", remote, receiver);
    await fs.writeFile(path.join(receiver, "local.txt"), "Receiver work stays here");
    const handoffId = "11111111-1111-4111-8111-111111111111";
    const pickup = await fetchHandoffWorktree(receiver, "feature/task", handoffId);
    expect(pickup.cwd.startsWith(root + path.sep)).toBe(true);
    expect(pickup.branch).toBe("feature/task");
    expect(await git(pickup.cwd, "rev-parse", "HEAD")).toBe(await git(remote, "rev-parse", "feature/task"));
    expect(await git(pickup.cwd, "branch", "--show-current")).toBe("feature/task");
    expect(await git(pickup.cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/feature/task");
    expect(await fs.readFile(path.join(receiver, "local.txt"), "utf8")).toBe("Receiver work stays here");
    expect(await fetchHandoffWorktree(receiver, "feature/task", handoffId)).toEqual(pickup);
  });
  it("fast-forwards an older local copy of the branch but refuses a diverged one", async () => {
    vi.stubEnv("DEVHUB_REPOS_DIR", root);
    await pushHandoffBranch(await inspectHandoffGit(checkout, "feature/task"), "helper", false);
    const receiver = path.join(root, "receiver"); await git(root, "clone", remote, receiver);
    await git(receiver, "config", "user.name", "Receiver"); await git(receiver, "config", "user.email", "r@example.invalid");
    await git(receiver, "branch", "feature/task", "origin/main");
    const ff = await fetchHandoffWorktree(receiver, "feature/task", "22222222-2222-4222-8222-222222222222");
    expect(await git(ff.cwd, "rev-parse", "HEAD")).toBe(await git(remote, "rev-parse", "feature/task"));
    const other = path.join(root, "receiver2"); await git(root, "clone", remote, other);
    await git(other, "config", "user.name", "Receiver"); await git(other, "config", "user.email", "r@example.invalid");
    await git(other, "checkout", "-b", "feature/task", "origin/main");
    await fs.writeFile(path.join(other, "mine.txt"), "diverged"); await git(other, "add", "mine.txt"); await git(other, "commit", "-m", "Diverged");
    await git(other, "checkout", "main");
    await expect(fetchHandoffWorktree(other, "feature/task", "33333333-3333-4333-8333-333333333333")).rejects.toThrow("different commits");
  });
  it.each([".env", ".env.local", "config/.env.production", ".devhub/state.json", "certs/server.pem", "id_ed25519"])("refuses Commit WIP when %s is among the changes", async (file) => {
    await fs.mkdir(path.dirname(path.join(checkout, file)), { recursive: true });
    await fs.writeFile(path.join(checkout, file), "SECRET=1");
    await expect(pushHandoffBranch(await inspectHandoffGit(checkout, "feature/task"), "helper", true)).rejects.toThrow("looks private");
    await expect(git(remote, "show-ref", "--verify", "refs/heads/feature/task")).rejects.toThrow();
  });
  it("normalises SSH and HTTPS without leaking credentials", () => {
    expect(normaliseGitOrigin("git@github.com:Org/Repo.git")).toBe("github.com/org/repo");
    expect(normaliseGitOrigin("https://github.com/Org/Repo.git")).toBe("github.com/org/repo");
    expect(() => normaliseGitOrigin("https://secret@github.com/org/repo")).toThrow("credentials");
  });
  it.each(["--all", "feature/../main", "bad name", "HEAD", "work;touch bad"])("rejects unsafe branch %s without a shell", async (branch) => {
    await expect(validateHandoffBranch(checkout, branch)).rejects.toThrow();
  });
  it("only pushes the task branch, never other local branches", async () => {
    const main = await git(remote, "rev-parse", "main");
    await fs.writeFile(path.join(checkout, "task.txt"), "changed\n"); await git(checkout, "add", "task.txt"); await git(checkout, "commit", "-m", "Task change");
    await git(checkout, "branch", "other-work");
    await git(checkout, "tag", "-a", "private-tag", "-m", "Do not publish this tag");
    await git(checkout, "config", "push.followTags", "true");
    const state = await inspectHandoffGit(checkout, "feature/task"); await pushHandoffBranch(state, "helper", false);
    expect(await git(remote, "rev-parse", "main")).toBe(main);
    expect(await git(remote, "rev-parse", "feature/task")).toBe(await git(checkout, "rev-parse", "HEAD"));
    await expect(git(remote, "show-ref", "--verify", "refs/heads/other-work")).rejects.toThrow();
    await expect(git(remote, "show-ref", "--verify", "refs/tags/private-tag")).rejects.toThrow();
  });
  it("refuses dirty work without the explicit WIP path and detects changed contents", async () => {
    await fs.writeFile(path.join(checkout, "new.txt"), "untracked");
    const dirty = await inspectHandoffGit(checkout, "feature/task"); expect(dirty.files).toContain("new.txt");
    await expect(pushHandoffBranch(dirty, "helper", false)).rejects.toThrow("Commit WIP");
    await fs.writeFile(path.join(checkout, "new.txt"), "different");
    await expect(pushHandoffBranch(dirty, "helper", true)).rejects.toThrow("checkout changed");
  });
  it("runs commit hooks and stops on failure instead of bypassing them", async () => {
    await fs.writeFile(path.join(checkout, "new.txt"), "untracked");
    const hooks = path.join(root, "hooks"); await fs.mkdir(hooks);
    await fs.writeFile(path.join(hooks, "pre-commit"), "#!/bin/sh\necho test-hook-refused >&2\nexit 1\n", { mode: 0o755 });
    await git(checkout, "config", "core.hooksPath", hooks);
    const state = await inspectHandoffGit(checkout, "feature/task");
    await expect(pushHandoffBranch(state, "helper", true)).rejects.toThrow("test-hook-refused");
    await expect(git(remote, "show-ref", "--verify", "refs/heads/feature/task")).rejects.toThrow();
  });
  it("commits WIP only when explicitly selected and preserves the requested message", async () => {
    await fs.writeFile(path.join(checkout, "new.txt"), "untracked");
    await pushHandoffBranch(await inspectHandoffGit(checkout, "feature/task"), "helper", true);
    expect(await git(checkout, "log", "-1", "--format=%s")).toBe("WIP: handoff to @helper");
  });
  it("refuses a rejected push without force and leaves the remote unchanged", async () => {
    await pushHandoffBranch(await inspectHandoffGit(checkout, "feature/task"), "helper", false);
    const other = path.join(root, "other"); await git(root, "clone", "--branch", "feature/task", remote, other);
    await git(other, "config", "user.name", "Other test"); await git(other, "config", "user.email", "other@example.invalid");
    await fs.writeFile(path.join(other, "remote.txt"), "remote changed"); await git(other, "add", "remote.txt"); await git(other, "commit", "-m", "Remote moved"); await git(other, "push", "origin", "feature/task");
    const head = await git(remote, "rev-parse", "feature/task");
    await fs.writeFile(path.join(checkout, "owner.txt"), "owner change"); await git(checkout, "add", "owner.txt"); await git(checkout, "commit", "-m", "Owner change");
    await expect(pushHandoffBranch(await inspectHandoffGit(checkout, "feature/task"), "helper", false)).rejects.toThrow();
    expect(await git(remote, "rev-parse", "feature/task")).toBe(head);
  });
});

