import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CANONICAL_UPDATE_SCRIPT = path.join(REPO_ROOT, "scripts", "devhub-update.sh");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function installUpdateScript(mirrorDir: string): string {
  const scriptsDir = path.join(mirrorDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, "devhub-update.sh");
  fs.copyFileSync(CANONICAL_UPDATE_SCRIPT, scriptPath);
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runUpdate(mirrorDir: string, extraArgs: string[] = []): { status: number; output: string } {
  const scriptPath = installUpdateScript(mirrorDir);
  try {
    const output = execFileSync("bash", [scriptPath, ...extraArgs], {
      cwd: mirrorDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("devhub-update.sh", () => {
  let tmp: string;
  let upstreamDir: string;
  let mirrorDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-update-"));
    upstreamDir = path.join(tmp, "upstream.git");
    mirrorDir = path.join(tmp, "mirror");

    git(REPO_ROOT, "init", "--bare", upstreamDir);
    fs.mkdirSync(mirrorDir, { recursive: true });
    git(mirrorDir, "init", "-b", "main");
    git(mirrorDir, "config", "user.email", "test@example.com");
    git(mirrorDir, "config", "user.name", "Test");

    fs.mkdirSync(path.join(mirrorDir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, "core.txt"), "base\n", "utf-8");
    fs.writeFileSync(path.join(mirrorDir, "tasks", "day.json"), "[]\n", "utf-8");
    git(mirrorDir, "add", ".");
    git(mirrorDir, "commit", "-m", "seed");
    const seed = git(mirrorDir, "rev-parse", "HEAD");

    fs.writeFileSync(path.join(mirrorDir, "core.txt"), "upstream-change\n", "utf-8");
    git(mirrorDir, "add", "core.txt");
    git(mirrorDir, "commit", "-m", "upstream v2");
    git(mirrorDir, "push", "--quiet", upstreamDir, "main");
    git(upstreamDir, "symbolic-ref", "HEAD", "refs/heads/main");

    git(mirrorDir, "reset", "--hard", seed);
    fs.writeFileSync(path.join(mirrorDir, "core.txt"), "mirror-change\n", "utf-8");
    git(mirrorDir, "add", "core.txt");
    git(mirrorDir, "commit", "-m", "mirror customization");
    git(mirrorDir, "update-ref", "refs/devhub/upstream-sync", seed);
    git(mirrorDir, "remote", "add", "upstream", upstreamDir);
    git(mirrorDir, "fetch", "--quiet", "upstream");
    git(mirrorDir, "remote", "set-head", "upstream", "main");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does not discard dirty personal tasks when apply conflicts", () => {
    const dirtyTasks = '[{"id":"1","text":"unsaved task edit"}]\n';
    fs.writeFileSync(path.join(mirrorDir, "tasks", "day.json"), dirtyTasks, "utf-8");

    const { status, output } = runUpdate(mirrorDir);
    expect(status).not.toBe(0);
    expect(output).toMatch(/Could not cleanly apply upstream changes/);

    expect(fs.readFileSync(path.join(mirrorDir, "tasks", "day.json"), "utf-8")).toBe(dirtyTasks);
    expect(fs.readFileSync(path.join(mirrorDir, "core.txt"), "utf-8")).toBe("mirror-change\n");
  });

  it("does not commit staged personal tasks on successful pull", () => {
    const localTmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-update-success-"));
    const localUpstream = path.join(localTmp, "upstream.git");
    const localMirror = path.join(localTmp, "mirror");

    git(REPO_ROOT, "init", "--bare", localUpstream);
    fs.mkdirSync(localMirror, { recursive: true });
    git(localMirror, "init", "-b", "main");
    git(localMirror, "config", "user.email", "test@example.com");
    git(localMirror, "config", "user.name", "Test");

    fs.mkdirSync(path.join(localMirror, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(localMirror, "core.txt"), "base\n", "utf-8");
    fs.writeFileSync(path.join(localMirror, "tasks", "day.json"), "[]\n", "utf-8");
    git(localMirror, "add", ".");
    git(localMirror, "commit", "-m", "seed");
    const seed = git(localMirror, "rev-parse", "HEAD");

    fs.writeFileSync(path.join(localMirror, "upstream-only.txt"), "new core file\n", "utf-8");
    git(localMirror, "add", "upstream-only.txt");
    git(localMirror, "commit", "-m", "upstream adds file");
    git(localMirror, "push", "--quiet", localUpstream, "main");
    git(localUpstream, "symbolic-ref", "HEAD", "refs/heads/main");

    git(localMirror, "reset", "--hard", seed);
    fs.writeFileSync(path.join(localMirror, "core.txt"), "mirror-change\n", "utf-8");
    git(localMirror, "add", "core.txt");
    git(localMirror, "commit", "-m", "mirror customization");
    git(localMirror, "update-ref", "refs/devhub/upstream-sync", seed);
    git(localMirror, "remote", "add", "upstream", localUpstream);
    git(localMirror, "fetch", "--quiet", "upstream");
    git(localMirror, "remote", "set-head", "upstream", "main");

    const stagedTasks = '[{"id":"1","text":"staged personal task"}]\n';
    fs.writeFileSync(path.join(localMirror, "tasks", "day.json"), stagedTasks, "utf-8");
    git(localMirror, "add", "tasks/day.json");

    const { status, output } = runUpdate(localMirror, ["--no-sync"]);
    expect(status).toBe(0);
    expect(output).toMatch(/Applied and committed/);

    const commitFiles = git(localMirror, "show", "--name-only", "--pretty=format:", "HEAD")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(commitFiles).toEqual(["upstream-only.txt"]);
    expect(commitFiles).not.toContain("tasks/day.json");

    expect(git(localMirror, "diff", "--cached", "--name-only")).toBe("tasks/day.json");
    expect(fs.readFileSync(path.join(localMirror, "tasks", "day.json"), "utf-8")).toBe(stagedTasks);

    fs.rmSync(localTmp, { recursive: true, force: true });
  });
});
