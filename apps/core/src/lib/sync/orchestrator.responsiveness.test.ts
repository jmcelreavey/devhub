import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectSkills } from "../collect/skills";
import { commitAndPushPaths, updateAndSync } from "./orchestrator";

vi.mock("./skills", () => ({ syncSkills: vi.fn(), verifySync: vi.fn() }));
vi.mock("./agents", () => ({ syncAgents: vi.fn() }));
vi.mock("./cowork", () => ({
  buildCoworkPlugin: vi.fn().mockResolvedValue({ code: 0, unchanged: true }),
  verifyCoworkPlugin: vi.fn(),
}));
vi.mock("./persona", () => ({ syncPersona: vi.fn() }));
vi.mock("./opencode-config", () => ({ syncOpencodeConfig: vi.fn() }));
vi.mock("../collect/skills", () => ({ collectSkills: vi.fn().mockResolvedValue(0) }));
vi.mock("../collect/agents", () => ({ collectAgents: vi.fn().mockResolvedValue(0) }));
vi.mock("../collect/opencode-config", () => ({ collectOpencodeConfig: vi.fn().mockResolvedValue(0) }));

let temporaryRoot: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("content sync responsiveness", () => {
  it("keeps the event loop available and leaves unrelated staged work alone", async () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-responsive-"));
    const repo = path.join(temporaryRoot, "repo");
    const remote = path.join(temporaryRoot, "origin.git");
    const release = path.join(temporaryRoot, "release-hook");
    fs.mkdirSync(repo);
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("SYNC_TEST_RELEASE", release);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("init", "--bare", remote);
    git("remote", "add", "origin", remote);
    fs.writeFileSync(path.join(repo, "initial.txt"), "initial\n");
    fs.mkdirSync(path.join(repo, "notes"));
    fs.writeFileSync(path.join(repo, "notes", "deleted.md"), "old note\n");
    git("add", "initial.txt", "notes");
    git("commit", "-m", "initial");
    fs.writeFileSync(path.join(repo, "initial.txt"), "already staged\n");
    git("add", "initial.txt");
    fs.unlinkSync(path.join(repo, "notes", "deleted.md"));
    fs.writeFileSync(path.join(repo, "notes", "entry.md"), "new note\n");
    const hook = path.join(repo, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, [
      "#!/bin/sh",
      "attempt=0",
      'while [ ! -e "$SYNC_TEST_RELEASE" ]; do',
      '  [ "$attempt" -ge 30 ] && exit 1',
      "  sleep 0.1",
      "  attempt=$((attempt + 1))",
      "done",
      "",
    ].join("\n"), { mode: 0o755 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await commitAndPushPaths({
      repoRoot: repo,
      paths: ["notes"],
      commitMessage: "chore: sync notes",
      emit: (line) => {
        if (line.startsWith("Committing scoped changes")) {
          timer = setTimeout(() => fs.writeFileSync(release, "ready"), 20);
        }
      },
    });
    if (timer) clearTimeout(timer);
    expect(result).toBe(0);
    expect(fs.existsSync(release)).toBe(true);
    expect(git("show", "--format=", "--name-only", "HEAD").toString().trim()).toBe("notes/deleted.md\nnotes/entry.md");
    expect(git("diff", "--cached", "--name-only").toString().trim()).toBe("initial.txt");
  }, 15_000);

  it("leaves pre-existing staged work untouched when update-and-sync starts dirty", async () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-dirty-"));
    const repo = path.join(temporaryRoot, "repo");
    const remote = path.join(temporaryRoot, "origin.git");
    fs.mkdirSync(repo);
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("init", "--bare", remote);
    git("remote", "add", "origin", remote);
    fs.writeFileSync(path.join(repo, "work.txt"), "original\n");
    git("add", "work.txt");
    git("commit", "-m", "initial");
    const head = git("rev-parse", "HEAD").toString();
    fs.writeFileSync(path.join(repo, "work.txt"), "unrelated staged work\n");
    git("add", "work.txt");

    expect(await updateAndSync({ repoRoot: repo, emit: () => {}, push: true })).toBe(0);
    expect(git("rev-parse", "HEAD").toString()).toBe(head);
    expect(git("diff", "--cached", "--name-only").toString().trim()).toBe("work.txt");
    expect(fs.existsSync(path.join(remote, "refs", "heads", "main"))).toBe(false);
  }, 15_000);

  it("does not commit or push partially collected changes after a collection failure", async () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-collect-"));
    const repo = path.join(temporaryRoot, "repo");
    const remote = path.join(temporaryRoot, "origin.git");
    fs.mkdirSync(repo);
    vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("init", "--bare", remote);
    git("remote", "add", "origin", remote);
    fs.writeFileSync(path.join(repo, "initial.txt"), "initial\n");
    git("add", "initial.txt");
    git("commit", "-m", "initial");
    git("push", "-u", "origin", "main");
    const head = git("rev-parse", "HEAD").toString();
    vi.mocked(collectSkills).mockImplementationOnce(async () => {
      fs.writeFileSync(path.join(repo, "collected.txt"), "partial\n");
      git("add", "collected.txt");
      return 1;
    });
    const output: string[] = [];

    expect(await updateAndSync({ repoRoot: repo, emit: (line) => output.push(line), push: true, force: true })).toBe(1);
    expect(output.join("\n")).toContain("Skill collection failed");
    expect(git("rev-parse", "HEAD").toString()).toBe(head);
    expect(git("diff", "--cached", "--name-only").toString().trim()).toBe("collected.txt");
  }, 15_000);
});
