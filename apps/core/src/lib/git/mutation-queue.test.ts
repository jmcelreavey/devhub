import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execExternal } from "../exec-external";
import { withRepoGitMutation } from "./mutation-queue";
import { runGitRepoAsync } from "./repo-local";

let root: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function makeRepo(name: string): string {
  if (!root) throw new Error("Missing temporary root");
  const repo = path.join(root, name);
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "initial.txt"), "initial\n");
  git("add", "initial.txt");
  git("commit", "-m", "initial");
  return repo;
}

describe("repository Git mutations", () => {
  it("does not refresh the index during a Git status read", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-status-read-"));
    const repo = makeRepo("repo");
    const file = path.join(repo, "initial.txt");
    const older = new Date(Date.now() - 60_000);
    fs.utimesSync(file, older, older);
    const index = path.join(repo, ".git", "index");
    const before = fs.readFileSync(index);
    await execExternal("git", ["-C", repo, "status", "--porcelain"]);
    expect(fs.readFileSync(index)).toEqual(before);
    execFileSync("git", ["status", "--porcelain"], { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: "1" } });
    expect(fs.readFileSync(index)).not.toEqual(before);
  });

  it("queues direct external Git writes and cancels a waiting command without blocking its successor", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-boundary-"));
    const repo = makeRepo("repo");
    fs.writeFileSync(path.join(repo, "new.txt"), "new\n");
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const holding = withRepoGitMutation(repo, async () => { entered(); await gate; });
    await ready;
    const controller = new AbortController();
    const cancelled = execExternal("git", ["-C", repo, "add", "new.txt"], { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "ABORT_ERR" });
    let finished = false;
    const next = execExternal("git", ["-C", repo, "--literal-pathspecs", "add", "new.txt"]).then(() => { finished = true; });
    try {
      await execExternal("git", ["-C", repo, "status", "--porcelain"]);
      expect(finished).toBe(false);
    } finally { release(); await holding; }
    await next;
    expect(finished).toBe(true);
  });

  it("lets hook subprocesses join their live parent's lease", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-hook-lease-"));
    const repo = makeRepo("repo");
    fs.writeFileSync(path.join(repo, "new.txt"), "new\n");
    const modulePath = fileURLToPath(new URL("../exec-external.ts", import.meta.url));
    const worker = `const { execExternal } = require(${JSON.stringify(modulePath)});
      execExternal("git", ["-C", ${JSON.stringify(repo)}, "add", "new.txt"])
        .catch(error => { console.error(error); process.exitCode = 1; });`;
    await withRepoGitMutation(repo, async () => {
      await execExternal(process.execPath, ["--import", "tsx", "--eval", worker], { timeoutMs: 10_000 });
    });
    expect((await runGitRepoAsync(repo, ["diff", "--cached", "--name-only"])).stdout.trim()).toBe("new.txt");
  });

  it("keeps the parent lease through the repository's pre-push environment cleanup", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-prepush-"));
    const repo = makeRepo("repo");
    const remote = path.join(root, "remote.git");
    execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
    const hookWorker = path.join(root, "hook.cjs");
    fs.writeFileSync(hookWorker, `const { execExternal } = require(${JSON.stringify(fileURLToPath(new URL("../exec-external.ts", import.meta.url)))});
      execExternal("git", ["-C", ${JSON.stringify(repo)}, "config", "devhub.hook-checked", "yes"])
        .catch(error => { console.error(error); process.exitCode = 1; });`);
    const tsx = require.resolve("tsx/cli");
    fs.copyFileSync(path.resolve("../../.githooks/pre-push"), path.join(repo, ".git", "hooks", "pre-push"));
    fs.chmodSync(path.join(repo, ".git", "hooks", "pre-push"), 0o755);
    fs.mkdirSync(path.join(repo, "scripts"));
    fs.writeFileSync(path.join(repo, "scripts", "scan-leaks.sh"), "#!/bin/sh\nexit 0\n");
    fs.copyFileSync(path.resolve("../../scripts/prepush.sh"), path.join(repo, "scripts", "prepush.sh"));
    fs.writeFileSync(path.join(repo, "scripts", "check-boundaries.mjs"), "");
    fs.writeFileSync(path.join(repo, "scripts", "prepush.test.mjs"), "");
    fs.mkdirSync(path.join(repo, "node_modules"), { recursive: true });
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    // Exercise the shipped hook without recursively running the whole test suite.
    fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\nif [ "$1" = "run" ] && [ "$2" = "--silent" ] && [ "$3" = "typecheck" ]; then\n  "${process.execPath}" "${tsx}" "${hookWorker}"\nfi\n`, { mode: 0o755 });
    await execExternal("git", ["-C", repo, "push", remote, "HEAD:main"], {
      timeoutMs: 10_000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TSX_TSCONFIG_PATH: path.resolve("tsconfig.json") },
    });
    expect((await execExternal("git", ["-C", repo, "config", "--get", "devhub.hook-checked"])).stdout.trim()).toBe("yes");
  });

  it("recovers after a lock-owning worker is killed", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-restart-"));
    const repo = makeRepo("repo");
    fs.writeFileSync(path.join(repo, "new.txt"), "new\n");
    const ready = path.join(root, "ready");
    const worker = `const fs = require("node:fs");
      const { withRepoGitMutation } = require(${JSON.stringify(fileURLToPath(new URL("./mutation-queue.ts", import.meta.url)))});
      withRepoGitMutation(${JSON.stringify(repo)}, async () => {
        fs.writeFileSync(${JSON.stringify(ready)}, "ready");
        await new Promise(() => setInterval(() => {}, 1000));
      });`;
    const controller = new AbortController();
    const child = execExternal(process.execPath, ["--import", "tsx", "--eval", worker], { signal: controller.signal, timeoutMs: 10_000 });
    void child.catch(() => {});
    try {
      const deadline = Date.now() + 5_000;
      while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fs.existsSync(ready)).toBe(true);
    } finally {
      controller.abort();
      await expect(child).rejects.toMatchObject({ code: "ABORT_ERR" });
    }
    await execExternal("git", ["-C", repo, "add", "new.txt"]);
    expect(fs.existsSync(path.join(repo, ".git", "devhub-mutation.lock"))).toBe(false);
  });
  it("queues writes across linked worktrees without blocking reads or other repositories", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-queue-"));
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const repo = makeRepo("first");
    const other = makeRepo("second");
    const worktree = path.join(root, "linked");
    execFileSync("git", ["worktree", "add", "--detach", worktree], { cwd: repo, stdio: "pipe" });
    fs.writeFileSync(path.join(worktree, "new.txt"), "linked\n");
    fs.writeFileSync(path.join(other, "new.txt"), "other\n");

    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const acquired = new Promise<void>((resolve) => { entered = resolve; });
    const transaction = withRepoGitMutation(repo, async () => {
      entered();
      await gate;
    });
    await acquired;
    let queuedFinished = false;
    const queued = runGitRepoAsync(worktree, ["add", "--", "new.txt"]).then((result) => {
      queuedFinished = true;
      return result;
    });
    try {
      expect((await runGitRepoAsync(worktree, ["status", "--porcelain"])).status).toBe(0);
      expect((await runGitRepoAsync(other, ["add", "--", "new.txt"])).status).toBe(0);
      expect(queuedFinished).toBe(false);
    } finally {
      release();
      await transaction;
    }
    expect((await queued).status).toBe(0);
    const staged = await runGitRepoAsync(worktree, ["diff", "--cached", "--name-only"]);
    expect(staged.stdout.trim()).toBe("new.txt");
  }, 15_000);

  it("queues linked-worktree writes behind another process without blocking reads or other repositories", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-process-queue-"));
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const repo = makeRepo("first");
    const other = makeRepo("second");
    const worktree = path.join(root, "linked");
    execFileSync("git", ["worktree", "add", "--detach", worktree], { cwd: repo, stdio: "pipe" });
    const nested = path.join(worktree, "nested");
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, "new.txt"), "linked\n");
    fs.writeFileSync(path.join(other, "new.txt"), "other\n");
    const readyFile = path.join(root, "ready");
    const releaseFile = path.join(root, "release");
    const modulePath = fileURLToPath(new URL("./mutation-queue.ts", import.meta.url));
    const worker = `const fs = require("node:fs");
      const { withRepoGitMutation } = require(${JSON.stringify(modulePath)});
      withRepoGitMutation(${JSON.stringify(repo)}, async () => {
        fs.writeFileSync(${JSON.stringify(readyFile)}, "ready");
        while (!fs.existsSync(${JSON.stringify(releaseFile)})) await new Promise(resolve => setTimeout(resolve, 20));
      }).catch(error => { console.error(error); process.exitCode = 1; });`;
    const child = execExternal(process.execPath, ["--import", "tsx", "--eval", worker], { cwd: process.cwd(), timeoutMs: 15_000 });
    void child.catch(() => {});
    let queued: Promise<Awaited<ReturnType<typeof runGitRepoAsync>>> | undefined;
    try {
      const deadline = Date.now() + 8_000;
      while (!fs.existsSync(readyFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fs.existsSync(readyFile)).toBe(true);
      queued = runGitRepoAsync(nested, ["add", "--", "new.txt"]);
      const completedWhileHeld = await Promise.race([queued.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 750))]);
      expect(completedWhileHeld).toBe(false);
      expect((await runGitRepoAsync(worktree, ["status", "--porcelain"])).status).toBe(0);
      expect((await runGitRepoAsync(other, ["add", "--", "new.txt"])).status).toBe(0);
    } finally {
      fs.writeFileSync(releaseFile, "release");
      await child;
      if (queued) expect((await queued).status).toBe(0);
    }
    const staged = await runGitRepoAsync(worktree, ["diff", "--cached", "--name-only"]);
    expect(staged.stdout.trim()).toBe("nested/new.txt");
  }, 20_000);

  it("recovers a lock left by a dead process", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-process-queue-"));
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const repo = makeRepo("repo");
    const lock = path.join(repo, ".git", "devhub-mutation.lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "dead"), JSON.stringify({ pid: 2_147_483_646 }));
    await expect(withRepoGitMutation(repo, async () => "recovered")).resolves.toBe("recovered");
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("releases the queue if the process lock cannot be created", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-process-queue-"));
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const repo = makeRepo("repo");
    const mkdir = vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("lock denied"), { code: "EACCES" });
    });
    try {
      const denied = withRepoGitMutation(repo, async () => "wrong");
      const next = withRepoGitMutation(repo, async () => "next");
      await expect(denied).rejects.toThrow("lock denied");
      await expect(next).resolves.toBe("next");
    } finally {
      mkdir.mockRestore();
    }
  });

  it("does not create a Git directory for a non-repository", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-process-queue-"));
    await expect(withRepoGitMutation(root, async () => "ok")).resolves.toBe("ok");
    expect(fs.existsSync(path.join(root, ".git"))).toBe(false);
  });

  it("releases the queue after failure and permits nested Git commands", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-queue-"));
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const repo = makeRepo("repo");
    fs.writeFileSync(path.join(repo, "new.txt"), "new\n");
    await expect(withRepoGitMutation(repo, async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    const result = await withRepoGitMutation(repo, () => runGitRepoAsync(repo, ["add", "--", "new.txt"]));
    expect(result.status).toBe(0);
  }, 15_000);
});
