import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/paseo/client", () => ({ withPaseo: vi.fn(), openPaseoSession: vi.fn(), paseoUrl: vi.fn() }));
vi.mock("@/lib/agent-runs/store", async (original) => ({
  ...await original<typeof import("@/lib/agent-runs/store")>(),
  listCapacityRuns: () => [],
  readAgentRun: () => null,
}));

import { runGitRepoAsync } from "@/lib/git/repo-local";
import type { Task } from "@/lib/tasks/types";
import { autoDeps, resetTaskToTodo, type OrchestratorDeps } from "./orchestrator";
import { mutateOrchestration, newOrchestration, readOrchestration } from "./orchestration-store";
import { newAutoState } from "./auto-mode";

const taskId = "reset-worktree";
const branch = "devhub/agent/reset-fixture";
let root: string;
let repo: string;
let checkout: string;
let notes: string;

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGitRepoAsync(cwd, args, { useGhCredentials: false });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function dependencies(): OrchestratorDeps {
  const task: Task = { id: taskId, text: "Reset a fixture", done: false, startDate: "2026-10-19", createdAt: "", rank: "a" };
  return {
    dispatch: vi.fn(async () => { throw new Error("Unexpected dispatch"); }),
    resolveRepos: async () => [],
    findTask: async () => task,
    auto: { setNoteStatus: vi.fn(), stopPreview: vi.fn() },
  };
}

const work = () => ({ cwd: checkout, worktree: { path: checkout, branch, repoRoot: repo } });

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "reset-worktree-")));
  repo = path.join(root, "repo");
  checkout = path.join(root, "agent-checkout");
  notes = path.join(root, "notes");
  fs.mkdirSync(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "core.hooksPath", "/dev/null"]);
  await git(repo, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"]);
  await git(repo, ["worktree", "add", "-b", branch, "--", checkout, "HEAD"]);
  await mutateOrchestration(taskId, null, () => ({
    ...newOrchestration({ taskId, taskDate: "2026-10-19" }),
    auto: { ...newAutoState("http://localhost:1349"), work: work() },
  }), notes);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("reset with real local worktrees", () => {
  it("discards only the task checkout and its local agent branch", async () => {
    fs.writeFileSync(path.join(checkout, "uncommitted.txt"), "task work");
    const result = await resetTaskToTodo({ action: "reset", taskId, discardWork: true }, dependencies(), notes);
    expect(result.removedCheckouts).toEqual([checkout]);
    expect(fs.existsSync(checkout)).toBe(false);
    expect(fs.existsSync(path.join(repo, ".git"))).toBe(true);
    expect((await runGitRepoAsync(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).status).toBe(1);
    expect(await git(repo, ["branch", "--show-current"])).toBe("main");
    expect(readOrchestration(taskId, notes)).toBeNull();
  });

  it("keeps a saved path reused for another branch and its uncommitted files", async () => {
    await git(checkout, ["switch", "-c", "personal-work"]);
    fs.writeFileSync(path.join(checkout, "keep.txt"), "unrelated work");
    const result = await resetTaskToTodo({ action: "reset", taskId, discardWork: true }, dependencies(), notes);
    expect(result.keptCheckouts).toContain(checkout);
    expect(result.removedCheckouts).toEqual([]);
    expect(fs.readFileSync(path.join(checkout, "keep.txt"), "utf8")).toBe("unrelated work");
    expect(await git(checkout, ["branch", "--show-current"])).toBe("personal-work");
    expect((await runGitRepoAsync(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).status).toBe(0);
  });

  it("respects an explicit worktree lock", async () => {
    await git(repo, ["worktree", "lock", "--reason", "keep this work", "--", checkout]);
    const result = await resetTaskToTodo({ action: "reset", taskId, discardWork: true }, dependencies(), notes);
    expect(result.keptCheckouts).toContain(checkout);
    expect(fs.existsSync(checkout)).toBe(true);
  });

  it("restores the saved branch without losing its commits", async () => {
    fs.writeFileSync(path.join(checkout, "saved.txt"), "committed work");
    await git(checkout, ["add", "saved.txt"]);
    await git(checkout, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "saved"]);
    const savedHead = await git(checkout, ["rev-parse", "HEAD"]);
    await git(repo, ["worktree", "remove", "--", checkout]);
    expect(await autoDeps(dependencies(), notes).restoreWork!(work())).toBe("restored");
    expect(await git(checkout, ["rev-parse", "HEAD"])).toBe(savedHead);
    expect(fs.readFileSync(path.join(checkout, "saved.txt"), "utf8")).toBe("committed work");
  });

  it("keeps a recoverable pin when the branch is checked out elsewhere", async () => {
    await git(repo, ["worktree", "remove", "--", checkout]);
    const otherCheckout = path.join(root, "another-checkout");
    await git(repo, ["worktree", "add", "--", otherCheckout, branch]);
    await expect(autoDeps(dependencies(), notes).restoreWork!(work())).rejects.toThrow();
    expect(readOrchestration(taskId, notes)?.auto?.work).toEqual(work());
    expect(await git(otherCheckout, ["branch", "--show-current"])).toBe(branch);
    expect(fs.existsSync(checkout)).toBe(false);
  });
});
