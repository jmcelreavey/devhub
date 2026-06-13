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

function installUpdateScript(mirrorDir: string, opts?: { stubPostSync?: boolean }): string {
  const scriptsDir = path.join(mirrorDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, "devhub-update.sh");
  let contents = fs.readFileSync(CANONICAL_UPDATE_SCRIPT, "utf-8");
  if (opts?.stubPostSync) {
    contents = contents
      .replaceAll("npx tsx scripts/run-action.ts validate", "echo STUB_VALIDATE")
      .replaceAll("npx tsx scripts/run-action.ts sync", "echo STUB_SYNC");
  }
  fs.writeFileSync(scriptPath, contents, "utf-8");
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runUpdate(
  mirrorDir: string,
  extraArgs: string[] = [],
  opts?: { stubPostSync?: boolean },
): { status: number; output: string } {
  const scriptPath = installUpdateScript(mirrorDir, opts);
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

    const { status, output } = runUpdate(mirrorDir, [], { stubPostSync: true });
    expect(status).not.toBe(0);
    expect(output).toMatch(/Could not cleanly apply upstream changes/);

    expect(fs.readFileSync(path.join(mirrorDir, "tasks", "day.json"), "utf-8")).toBe(dirtyTasks);
    expect(fs.readFileSync(path.join(mirrorDir, "core.txt"), "utf-8")).toBe("mirror-change\n");
  });

  it("runs validate+sync when already up to date (retry after post-commit failure)", () => {
    const upstreamHead = git(mirrorDir, "rev-parse", "upstream/main");
    git(mirrorDir, "update-ref", "refs/devhub/upstream-sync", upstreamHead);
    fs.mkdirSync(path.join(mirrorDir, "dashboard", "scripts"), { recursive: true });

    const { status, output } = runUpdate(mirrorDir, [], { stubPostSync: true });
    expect(status).toBe(0);
    expect(output).toMatch(/Already up to date/);
    expect(output).toContain("STUB_VALIDATE");
    expect(output).toContain("STUB_SYNC");
  });

  it("rejects staged personal tasks before pull (would leak into core commit)", () => {
    const stagedTasks = '[{"id":"1","text":"staged secret"}]\n';
    fs.writeFileSync(path.join(mirrorDir, "tasks", "day.json"), stagedTasks, "utf-8");
    git(mirrorDir, "add", "tasks/day.json");

    const { status, output } = runUpdate(mirrorDir);
    expect(status).not.toBe(0);
    expect(output).toMatch(/Staged changes in personal-data paths/);
    expect(git(mirrorDir, "diff", "--cached", "--name-only")).toBe("tasks/day.json");
  });
});
