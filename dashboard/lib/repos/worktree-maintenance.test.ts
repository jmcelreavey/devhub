import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { upsertTerminalSession, removeTerminalSession } from "@/lib/terminal-sessions-registry";
import { cleanupWorktrees, parseProcessCwds } from "./worktree-maintenance";
import type { WorktreeContext } from "./worktree-inventory";

const mocks = vi.hoisted(() => ({ root: "", paseo: vi.fn(), processes: vi.fn(), tasks: vi.fn(), runs: vi.fn(), taskRuns: vi.fn() }));
vi.mock("@/lib/content/dirs", async (original) => ({ ...await original<typeof import("@/lib/content/dirs")>(), getCheckoutRoot: () => mocks.root }));
vi.mock("@/lib/paseo/workspaces", () => ({ loadPaseoWorktreeActivity: mocks.paseo }));
vi.mock("@/lib/exec-external", async (original) => {
  const actual = await original<typeof import("@/lib/exec-external")>();
  return { ...actual, execExternal: (file: string, args: string[], options: Parameters<typeof actual.execExternal>[2]) =>
    file === "lsof" ? mocks.processes() : actual.execExternal(file, args, options) };
});
vi.mock("@/lib/agent-runs/store", () => ({ listAgentRuns: mocks.runs }));
vi.mock("@/lib/tasks/storage", () => ({ listTaskDays: mocks.tasks }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ listTaskAgentRuns: mocks.taskRuns }));
vi.mock("@/lib/notes/note-index", () => ({ getNoteIndex: () => ({ notes: [] }) }));

let root: string, linked: string, gitDir: string;
const DAY_MS = 86_400_000;
const git = async (args: string[], cwd = root) => (await execExternal("git", args, { cwd })).stdout.trim();
const commit = async (cwd = root, message = "fixture") => {
  await git(["add", "."], cwd);
  await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", message], cwd);
};
function ageDirectory(directory: string, days: number): void {
  const old = new Date(Date.now() - days * DAY_MS - 5000);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) ageDirectory(file, days);
    else if (!entry.isSymbolicLink()) fs.utimesSync(file, old, old);
  }
  fs.utimesSync(directory, old, old);
}
function age(days = 3): void { ageDirectory(linked, days); ageDirectory(gitDir, days); }
function build(relative: string): string {
  const directory = path.join(linked, relative);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "artifact"), "x".repeat(16_384));
  return directory;
}
function taskContext(done = false, status: "done" | "paused" = "done"): void {
  const item: WorktreeContext["tasks"][number] = { date: "2026-09-24",
    task: { id: "task-1", text: "Keep this work", done, createdAt: "2026-09-24", startDate: "2026-09-24", rank: "1" },
    runs: [{ runId: "run-abcdef-12345678", branch: "feature", cwd: linked, status, startedAt: "2026-09-24", updatedAt: "2026-09-24" }],
  };
  mocks.tasks.mockReturnValue([{ date: item.date, tasks: [item.task] }]);
  mocks.taskRuns.mockReturnValue(item.runs);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.paseo.mockResolvedValue([]);
  mocks.processes.mockResolvedValue({ stdout: "p1\nfcwd\nn/\n", stderr: "" });
  mocks.tasks.mockReturnValue([]);
  mocks.runs.mockReturnValue([]);
  mocks.taskRuns.mockReturnValue([]);
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-maintenance-")));
  mocks.root = root;
  await git(["init", "-b", "main"]);
  fs.mkdirSync(path.join(root, "dashboard/lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "dashboard/lib/plugin-branding.generated.ts"), "baseline\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".devhub/\nnode_modules/\n.next/\ntarget/\n.env\n");
  fs.writeFileSync(path.join(root, "source.txt"), "source\n");
  fs.writeFileSync(path.join(root, "Cargo.toml"), "[package]\nname = 'fixture'\n");
  await commit();
  await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  linked = path.join(root, ".devhub/checkouts/feature");
  await git(["worktree", "add", "-b", "feature", linked]);
  gitDir = await git(["rev-parse", "--absolute-git-dir"], linked);
  age();
});
afterEach(() => {
  removeTerminalSession(876543);
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("idle worktree maintenance", () => {
  it("removes an old clean branch at origin/main, prunes metadata and keeps the branch", async () => {
    const result = await cleanupWorktrees(vi.fn());
    expect(result.errors).toEqual([]);
    expect(result.removed).toEqual([linked]);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(linked)).toBe(false);
    expect(await git(["branch", "--list", "feature"])).toContain("feature");
    expect(await git(["worktree", "list"])).not.toContain(linked);
  });
  it("dry-runs without changing Git, generated files or build directories", async () => {
    fs.writeFileSync(path.join(linked, "dashboard/lib/plugin-branding.generated.ts"), "generated\n");
    const modules = build("dashboard/node_modules");
    age();
    const emit = vi.fn();
    const result = await cleanupWorktrees(emit, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, removed: [], trimmed: [], freedBytes: 0, errors: [] });
    expect(result.plannedBytes).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(linked, "dashboard/lib/plugin-branding.generated.ts"), "utf8")).toBe("generated\n");
    expect(fs.existsSync(modules)).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.stringContaining("Would remove"));
  });
  it("ignores only known unstaged generated branding files when removing", async () => {
    fs.writeFileSync(path.join(linked, "dashboard/lib/plugin-branding.generated.ts"), "generated\n");
    age();
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([linked]);
  });
  it.each(["modified", "untracked", "staged", "renamed", "generated-staged"])("keeps %s changes", async (kind) => {
    if (kind === "renamed") await git(["mv", "source.txt", "renamed.txt"], linked);
    else {
      const file = kind === "untracked" ? "new.txt" : kind === "generated-staged" ? "dashboard/lib/plugin-branding.generated.ts" : "source.txt";
      fs.writeFileSync(path.join(linked, file), "keep\n");
      if (kind === "staged" || kind === "generated-staged") await git(["add", file], linked);
    }
    age();
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
    expect(fs.existsSync(linked)).toBe(true);
  });
  it.each(["--assume-unchanged", "--skip-worktree"])("does not delete source hidden by %s", async (flag) => {
    await git(["update-index", flag, "source.txt"], linked);
    fs.writeFileSync(path.join(linked, "source.txt"), "hidden local changes\n");
    age();
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
    expect(fs.existsSync(linked)).toBe(true);
  });
  it("does not mistake commits pushed elsewhere for commits on origin/main", async () => {
    fs.writeFileSync(path.join(linked, "source.txt"), "new commit\n");
    await commit(linked);
    await git(["update-ref", "refs/remotes/origin/feature", "HEAD"], linked);
    age();
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
  });
  it("never treats a squash-equivalent branch as having no commits beyond origin/main", async () => {
    fs.writeFileSync(path.join(linked, "source.txt"), "squashed\n");
    await commit(linked);
    await git(["merge", "--squash", "feature"]);
    await commit(root, "squash");
    await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    age();
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
  });
  it("keeps detached heads and worktrees outside the checkout directory", async () => {
    await git(["checkout", "--detach"], linked);
    const outside = path.join(root, "outside");
    await git(["worktree", "add", "-b", "outside", outside]);
    age();
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
    expect(fs.existsSync(outside)).toBe(true);
  });
  it.each(["locked", "recent-root", "recent-nested", "recent-index"])("keeps %s worktrees", async (kind) => {
    if (kind === "locked") await git(["worktree", "lock", linked]);
    if (kind === "recent-root") fs.utimesSync(linked, new Date(), new Date());
    if (kind === "recent-nested") {
      fs.mkdirSync(path.join(linked, "nested"));
      fs.writeFileSync(path.join(linked, "nested/new.txt"), "new\n");
      const old = new Date(Date.now() - 3 * DAY_MS);
      fs.utimesSync(linked, old, old);
      fs.utimesSync(path.join(linked, "nested"), old, old);
    }
    if (kind === "recent-index") fs.utimesSync(path.join(gitDir, "index"), new Date(), new Date());
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
  });
  it.each(["task", "paused-run", "process", "terminal", "paseo", "agent-run"])("protects active %s", async (kind) => {
    if (kind === "task") taskContext();
    if (kind === "paused-run") taskContext(true, "paused");
    if (kind === "process") mocks.processes.mockResolvedValue({ stdout: `p2\nfcwd\nn${linked}/dashboard\n`, stderr: "" });
    if (kind === "terminal") upsertTerminalSession({ tabId: 876543, sessionId: "test", label: "test", cwd: linked, status: "open", busy: false, updatedAt: Date.now() });
    if (kind === "paseo") mocks.paseo.mockResolvedValue([{ path: linked, active: true, updatedAt: 0 }]);
    if (kind === "agent-run") mocks.runs.mockReturnValue([{ spec: { id: "active", cwd: root, worktree: { path: linked }, title: "Active" }, status: { state: "needs-attention", updatedAt: 0 } }]);
    build("node_modules");
    age(8);
    const result = await cleanupWorktrees(vi.fn());
    expect(result.errors).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.trimmed).toEqual([]);
    expect(fs.existsSync(linked)).toBe(true);
  });
  it("protects branch-linked tasks even when their legacy run has no cwd", async () => {
    taskContext();
    mocks.taskRuns.mockReturnValue([{ runId: "run-abcdef-12345678", branch: "feature", status: "done", updatedAt: "2026-09-24" }]);
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
  });
  it.each(["paseo", "processes", "partial-processes", "origin", "git-operation"])("fails closed for unavailable %s evidence", async (kind) => {
    if (kind === "paseo") mocks.paseo.mockRejectedValue(new Error("Paseo down"));
    if (kind === "processes") mocks.processes.mockRejectedValue(new Error("lsof failed"));
    if (kind === "partial-processes") mocks.processes.mockResolvedValue({ stdout: "p1\nn/\n", stderr: "permission denied" });
    if (kind === "origin") await git(["update-ref", "-d", "refs/remotes/origin/main"]);
    if (kind === "git-operation") fs.mkdirSync(path.join(gitDir, "rebase-merge"));
    const result = await cleanupWorktrees(vi.fn());
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(linked)).toBe(true);
  });
  it("rechecks active sessions immediately before removal", async () => {
    mocks.paseo.mockResolvedValueOnce([]).mockResolvedValue([{ path: linked, active: true, updatedAt: 0 }]);
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
  });
  it("rechecks commits immediately before removal", async () => {
    mocks.paseo.mockResolvedValueOnce([]).mockImplementation(async () => {
      fs.writeFileSync(path.join(linked, "source.txt"), "concurrent commit\n");
      await commit(linked);
      age();
      return [];
    });
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
  });
  it("trims only ignored builds in kept 7-day-idle worktrees, preserving source, changes and branch", async () => {
    fs.writeFileSync(path.join(linked, "source.txt"), "uncommitted source\n");
    const builds = [build("dashboard/node_modules"), build("dashboard/.next"), build("target")];
    const other = build("output");
    age(8);
    const result = await cleanupWorktrees(vi.fn());
    expect(result.errors).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.trimmed.sort()).toEqual(builds.sort());
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.readFileSync(path.join(linked, "source.txt"), "utf8")).toBe("uncommitted source\n");
    expect(await git(["branch", "--list", "feature"])).toContain("feature");
  });
  it("dry-runs build trimming without deleting it", async () => {
    fs.writeFileSync(path.join(linked, "source.txt"), "kept\n");
    const modules = build("node_modules");
    age(8);
    const result = await cleanupWorktrees(vi.fn(), { dryRun: true });
    expect(result.trimmed).toEqual([]);
    expect(result.plannedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(modules)).toBe(true);
  });
  it("does not trim tracked builds, unrecognised target folders or 6-day-idle builds", async () => {
    const modules = build("node_modules");
    await git(["add", "-f", "node_modules/artifact"], linked);
    const target = build("data/target");
    age(8);
    expect((await cleanupWorktrees(vi.fn())).trimmed).toEqual([]);
    expect(fs.existsSync(modules)).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
    await git(["reset", "HEAD", "node_modules/artifact"], linked);
    fs.writeFileSync(path.join(linked, "source.txt"), "keep\n");
    age(6);
    expect((await cleanupWorktrees(vi.fn())).trimmed).toEqual([]);
  });
  it("keeps ignored secrets but can trim their idle builds", async () => {
    fs.writeFileSync(path.join(linked, ".env"), "FIXTURE=value\n");
    const modules = build("node_modules");
    age(8);
    const result = await cleanupWorktrees(vi.fn());
    expect(result.removed).toEqual([]);
    expect(result.trimmed).toEqual([modules]);
    expect(fs.existsSync(path.join(linked, ".env"))).toBe(true);
  });
  it("does not follow checkout or build symlinks", async () => {
    const outside = path.join(root, "outside-data");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "keep"), "keep\n");
    fs.symlinkSync(outside, path.join(linked, "node_modules"));
    fs.writeFileSync(path.join(linked, "source.txt"), "keep\n");
    age(8);
    expect((await cleanupWorktrees(vi.fn())).trimmed).toEqual([]);
    fs.renameSync(linked, path.join(root, "moved"));
    fs.symlinkSync(path.join(root, "moved"), linked);
    expect((await cleanupWorktrees(vi.fn())).removed).toEqual([]);
    expect(fs.readFileSync(path.join(outside, "keep"), "utf8")).toBe("keep\n");
  });
  it("rejects empty or malformed process cwd output", () => {
    expect(() => parseProcessCwds("")).toThrow();
    expect(() => parseProcessCwds("p1\nnrelative\n")).toThrow();
    expect(() => parseProcessCwds("p1\nn/\np2\n")).toThrow();
    expect(parseProcessCwds("p1\nfcwd\nn/tmp/a b\n")).toEqual(["/tmp/a b"]);
  });
});
