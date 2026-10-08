import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { upsertTerminalSession, removeTerminalSession } from "@/lib/terminal-sessions-registry";
import { describeWorktree, inspectWorktree, worktreeInventory, type WorktreeContext } from "./worktree-inventory";
import { workspaceOption } from "./worktree-info";
vi.mock("@/lib/agent-runs/store", () => ({ listAgentRuns: () => [] }));
vi.mock("@/lib/tasks/storage", () => ({ listTaskDays: () => [] }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ listTaskAgentRuns: () => [] }));
vi.mock("@/lib/notes/note-index", () => ({ getNoteIndex: () => ({ notes: [] }) }));
let root: string, linked: string;
const empty: WorktreeContext = { tasks: [], runs: [], notes: [] };
const git = (args: string[], cwd = root) => execExternal("git", args, { cwd });
beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-inventory-")));
  await git(["init"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".env\nnode_modules/\n");
  await git(["add", ".gitignore"]);
  await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  linked = path.join(root, ".git", "devhub-worktrees", "feature");
  await git(["worktree", "add", "-b", "ptf-5014-analytics-debug", linked]);
});
afterEach(() => { removeTerminalSession(987654); fs.rmSync(root, { recursive: true, force: true }); });
function context(cwd = linked): WorktreeContext {
  return { ...empty, tasks: [{ date: "2026-09-24",
    task: { id: "task-1", text: "Analytics debug overlay #analytics", done: true, jiraKey: "PTF-5014", createdAt: "2026-09-24", startDate: "2026-09-24", rank: "1" },
    runs: [{ runId: "run-abcdef-12345678", status: "done", cwd, startedAt: "2026-09-24", updatedAt: "2026-09-24" }],
  }] };
}
describe("worktree inventory", () => {
  it("accepts a squash-merged head while preserving dirty or newer work", async () => {
    fs.writeFileSync(path.join(linked, "feature.txt"), "merged");
    await git(["add", "feature.txt"], linked);
    await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "feature"], linked);
    const tree = (await worktreeInventory(root, false, undefined, empty)).worktrees[1];
    await git(["merge", "--squash", tree.branch!]);
    await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "squash"]);
    await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const merges = { prs: [{ number: 1, url: "https://github.com/test/repo/pull/1", headRefName: tree.branch!, headRefOid: tree.head, mergedAt: "2026-10-01", isCrossRepository: false }] };
    const merged = await inspectWorktree(tree, merges);
    expect(merged.details).toMatchObject({ unpushedCount: 1, candidate: true, blockers: [] });
    expect(merged.merge?.verified).toBe(true);
    const integrated = { prs: [], defaultBranch: { name: "main", head: (await git(["rev-parse", "HEAD"])).stdout.trim(), tree: (await git(["rev-parse", "HEAD^{tree}"])).stdout.trim() } };
    expect((await inspectWorktree(tree, integrated)).details).toMatchObject({ candidate: true, blockers: [] });
    fs.writeFileSync(path.join(linked, "new.txt"), "keep me");
    expect((await inspectWorktree(tree, merges)).details?.candidate).toBe(false);
    expect((await inspectWorktree(tree, integrated)).details?.candidate).toBe(false);
    await git(["add", "new.txt"], linked);
    await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "newer"], linked);
    const newer = (await worktreeInventory(root, false, undefined, empty)).worktrees[1];
    const result = await inspectWorktree(newer, merges);
    expect(result.merge?.verified).toBe(false);
    expect(result.details?.candidate).toBe(false);
    expect((await inspectWorktree(newer, integrated)).details?.candidate).toBe(false);
    expect(fs.readFileSync(path.join(linked, "new.txt"), "utf8")).toBe("keep me");
  });
  it("discovers hidden checkouts and associates task context without matching main", async () => {
    const result = await worktreeInventory(root, false, "task-1", context());
    expect(result.worktrees).toHaveLength(2);
    expect(result.preferredPath).toBe(linked);
    expect(result.worktrees[0].tasks).toHaveLength(0);
    expect(result.worktrees[0].title).toBe("Main checkout");
    const tree = result.worktrees[1];
    expect(tree.title).toBe("Analytics debug overlay");
    expect(workspaceOption(tree, root).hint).toContain("PTF-5014");
  });
  it("retains a removed task path instead of falling back to main", async () => {
    await git(["worktree", "remove", linked]);
    const result = await worktreeInventory(root, false, "task-1", context());
    expect(result.preferredPath).toBe(linked);
    expect(result.worktrees.some((tree) => tree.path === result.preferredPath)).toBe(false);
  });
  it("previews ignored files and blocks changes, unpushed commits, active runs, locks and terminals", async () => {
    const inventory = await worktreeInventory(root, false, undefined, context());
    let tree = inventory.worktrees[1];
    fs.writeFileSync(path.join(linked, ".env"), "FIXTURE=value");
    let result = await inspectWorktree(tree);
    expect(result.details).toMatchObject({ dirtyCount: 0, unpushedCount: 0, candidate: true, ignoredPaths: [".env"] });
    expect((await inspectWorktree(inventory.worktrees[0])).details?.blockers).toContain("Main checkout");
    fs.writeFileSync(path.join(linked, "local.txt"), "local");
    expect((await inspectWorktree(tree)).details?.blockers).toContain("1 changed or untracked files");
    await git(["add", "local.txt"], linked);
    await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "local"], linked);
    result = await inspectWorktree(tree);
    expect(result.details?.unpushedCount).toBe(1);
    tree = { ...tree, locked: true, runs: [{ id: "active", title: "Work", status: "running", active: true, updatedAt: Date.now() }] };
    expect((await inspectWorktree(tree)).details?.blockers).toEqual(expect.arrayContaining(["Locked", "Agent run still active or awaiting input"]));
    upsertTerminalSession({ tabId: 987654, sessionId: "test", label: "test", cwd: linked, status: "open", busy: false, updatedAt: Date.now() });
    expect((await inspectWorktree(tree)).details?.blockers).toContain("Open DevHub terminal in this checkout");
  });
  it("does not leak nested worktree associations to the main checkout", async () => {
    const main = (await worktreeInventory(root, false, undefined, empty)).worktrees[0];
    expect(describeWorktree(main, context()).tasks).toEqual([]);
  });
});
