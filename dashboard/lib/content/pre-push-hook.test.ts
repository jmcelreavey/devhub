import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_SYNC_PATHS } from "./sync-paths";

// Assembled at runtime so the repo's own leak scan doesn't flag this test.
const LEAK_LINE = ["see the ", "heim", "dall service\n"].join("");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HOOK_SRC = path.join(REPO_ROOT, ".githooks", "pre-push");
const SCAN_SRC = path.join(REPO_ROOT, "scripts", "scan-leaks.sh");

let root: string;
let work: string;
let npmLog: string;

/** A clean env: this suite itself runs inside the real pre-push hook, with GIT_DIR and DEVHUB_* set. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    HOME: root,
    PATH: [path.join(root, "bin"), path.dirname(process.execPath), "/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin"].join(path.delimiter),
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
    NPM_LOG: npmLog,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

function git(cwd: string, args: string[], extra: Record<string, string> = {}) {
  return spawnSync("git", args, { cwd, encoding: "utf-8", env: cleanEnv(extra) });
}

function mustGit(cwd: string, ...args: string[]): void {
  const r = git(cwd, args);
  expect(r.status, `${args.join(" ")}\n${r.stderr}`).toBe(0);
}

function commitFile(file: string, body = "x\n"): void {
  fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
  fs.writeFileSync(path.join(work, file), body);
  mustGit(work, "add", "-A");
  mustGit(work, "commit", "-q", "-m", `edit ${file}`);
}

/** Push with the real hook. Returns combined output, exit status and whether the stub `npm` ran. */
function push(refspec: string, extra: Record<string, string> = {}) {
  const r = git(work, ["push", "origin", refspec], extra);
  const verifyRuns = fs.existsSync(npmLog) ? fs.readFileSync(npmLog, "utf-8").trim().split("\n").filter(Boolean) : [];
  fs.rmSync(npmLog, { force: true });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, verifyRuns };
}

const CONTENT = { DEVHUB_PREPUSH: "content" };

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-prepush-")));
  work = path.join(root, "work");
  npmLog = path.join(root, "npm-calls.txt");
  fs.writeFileSync(path.join(root, "gitconfig"), "[user]\n\tname = T\n\temail = t@example.com\n[init]\n\tdefaultBranch = main\n");
  // The stub that stands in for `npm run verify`: records that it was asked to.
  fs.mkdirSync(path.join(root, "bin"));
  fs.writeFileSync(path.join(root, "bin", "npm"), '#!/bin/sh\necho "$@" >> "$NPM_LOG"\n', { mode: 0o755 });

  fs.mkdirSync(path.join(root, "remote.git"));
  mustGit(path.join(root, "remote.git"), "init", "--bare", "-q");
  fs.mkdirSync(work);
  mustGit(work, "init", "-q");
  mustGit(work, "remote", "add", "origin", path.join(root, "remote.git"));
  fs.mkdirSync(path.join(work, "scripts"));
  fs.copyFileSync(SCAN_SRC, path.join(work, "scripts", "scan-leaks.sh"));
  fs.mkdirSync(path.join(work, "dashboard", "node_modules"), { recursive: true });
  commitFile("README.md");
  // Seed the remote before the hook exists, so only the pushes under test run it.
  mustGit(work, "push", "-q", "origin", "main");
  fs.copyFileSync(HOOK_SRC, path.join(work, ".git", "hooks", "pre-push"));
  fs.chmodSync(path.join(work, ".git", "hooks", "pre-push"), 0o755);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("pre-push DEVHUB_PREPUSH=content", () => {
  it("skips verify for a content-only push, and the leak scan still runs", () => {
    commitFile("notes/a.md");
    commitFile("tasks/2026-01-01.json", "{}\n");
    const r = push("main", CONTENT);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Scanning for internal-name / secret leaks");
    expect(r.out).toContain("Leak scan passed");
    expect(r.out).toContain("skipping verify");
    expect(r.verifyRuns).toEqual([]);
  });

  it("runs the full verify when the push touches code, and says why", () => {
    commitFile("notes/a.md");
    commitFile("dashboard/lib/x.ts");
    const r = push("main", CONTENT);
    expect(r.status).toBe(0);
    expect(r.out).toContain("dashboard/lib/x.ts");
    expect(r.out).toContain("running the full verify");
    expect(r.verifyRuns).toEqual(["run --silent verify"]);
  });

  it("judges each commit: code added in one commit and removed in the next still verifies", () => {
    commitFile("dashboard/lib/x.ts");
    mustGit(work, "rm", "-q", "dashboard/lib/x.ts");
    mustGit(work, "commit", "-q", "-m", "drop it");
    commitFile("notes/a.md");
    expect(push("main", CONTENT).verifyRuns).toHaveLength(1);
  });

  it("runs verify for a content-only push when the switch is off", () => {
    commitFile("notes/a.md");
    const r = push("main");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Leak scan passed");
    expect(r.verifyRuns).toEqual(["run --silent verify"]);
  });

  it("only honours the exact value 'content'", () => {
    commitFile("notes/a.md");
    expect(push("main", { DEVHUB_PREPUSH: "1" }).verifyRuns).toHaveLength(1);
  });

  it("blocks a leak in a content-only push even though verify is skipped", () => {
    commitFile("docs/leak.md", LEAK_LINE);
    const r = push("main", CONTENT);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Leak scan FAILED");
    expect(r.verifyRuns).toEqual([]);
    expect(git(path.join(root, "remote.git"), ["log", "--oneline", "main"]).stdout.trim().split("\n")).toHaveLength(1);
  });

  it("treats a rename out of a content folder as touching code", () => {
    commitFile("notes/a.md");
    expect(push("main", CONTENT).verifyRuns).toEqual([]);
    mustGit(work, "mv", "notes/a.md", "dashboard/a.md");
    mustGit(work, "commit", "-q", "-m", "move");
    expect(push("main", CONTENT).verifyRuns).toHaveLength(1);
  });

  it("does not treat task timers as content", () => {
    commitFile("tasks/.local/timers.json", "{}\n");
    expect(push("main", CONTENT).verifyRuns).toHaveLength(1);
  });

  it("handles a new remote branch: content-only skips, any code verifies", () => {
    mustGit(work, "checkout", "-q", "-b", "side");
    commitFile("notes/a.md");
    commitFile("collections/c.md");
    const content = push("side", CONTENT);
    expect(content.status).toBe(0);
    expect(content.verifyRuns).toEqual([]);

    mustGit(work, "checkout", "-q", "-b", "side2", "main");
    commitFile("package.json", "{}\n");
    commitFile("notes/b.md");
    const mixed = push("side2", CONTENT);
    expect(mixed.verifyRuns).toHaveLength(1);
    expect(mixed.out).toContain("package.json");
  });

  it("lets a branch delete through without running verify", () => {
    mustGit(work, "branch", "gone");
    expect(push("gone", CONTENT).status).toBe(0);
    const r = push(":gone", CONTENT);
    expect(r.status).toBe(0);
    expect(r.verifyRuns).toEqual([]);
    expect(r.out).toContain("Leak scan passed");
  });
});

describe("pre-push DEVHUB_SKIP_VERIFY", () => {
  it("keeps its meaning: skips everything, leak scan included", () => {
    commitFile("docs/leak.md", LEAK_LINE);
    const r = push("main", { DEVHUB_SKIP_VERIFY: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("DEVHUB_SKIP_VERIFY=1");
    expect(r.verifyRuns).toEqual([]);
  });
});

describe("pre-push content paths", () => {
  it("match CONTENT_SYNC_PATHS in dashboard/lib/content/sync-paths.ts", () => {
    const hook = fs.readFileSync(HOOK_SRC, "utf-8");
    const match = /^CONTENT_PATHS=\(([^)]*)\)/m.exec(hook);
    expect(match, "CONTENT_PATHS=(…) in .githooks/pre-push").not.toBeNull();
    expect(match![1].trim().split(/\s+/)).toEqual([...CONTENT_SYNC_PATHS]);
  });
});
