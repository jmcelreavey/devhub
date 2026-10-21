import fs from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { OrchestrationRecord } from "./types";
import { cleanupFinishedAutoWork } from "./cleanup-work";

const mocks = vi.hoisted(() => ({ read: vi.fn(), mutate: vi.fn(), git: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/git/repo-local", () => ({ runGitRepoAsync: mocks.git }));
vi.mock("@/lib/repos/worktree-maintenance", () => ({ cleanupWorktrees: mocks.cleanup }));
vi.mock("./orchestration-store", () => ({
  readOrchestration: mocks.read, mutateOrchestration: mocks.mutate,
  withOrchestrationWorkLock: (_task: string, _notes: string, work: () => Promise<void>) => work(),
  withOrchestrationMutationLock: (_task: string, _notes: string, work: () => Promise<void>) => work(),
}));
let record: OrchestrationRecord;
beforeEach(() => {
  vi.clearAllMocks();
  record = { status: "ready-for-review", auto: { phase: "ready", verify: { reviewDone: true, qaSkipped: "No UI changes" },
    work: { cwd: "/repo/tree", worktree: { path: "/repo/tree", repoRoot: "/repo", branch: "old-branch" } } } } as OrchestrationRecord;
  mocks.read.mockImplementation(() => record);
  mocks.git.mockResolvedValue({ status: 0, stdout: "actual-branch\n" });
  mocks.cleanup.mockResolvedValue({ errors: [] });
  mocks.mutate.mockImplementation(async (_id: string, _key: null, change: (current: OrchestrationRecord) => OrchestrationRecord) => change(record));
  vi.spyOn(fs, "existsSync").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());
it("saves the actual branch before releasing a verified checkout", async () => {
  mocks.cleanup.mockImplementation(async () => {
    expect(record.auto?.work?.worktree?.branch).toBe("actual-branch");
    return { errors: [] };
  });
  await cleanupFinishedAutoWork("task", "/notes", vi.fn());
  expect(mocks.cleanup).toHaveBeenCalledWith(expect.any(Function), { dryRun: false,
    release: { path: "/repo/tree", repoRoot: "/repo", branch: "actual-branch", taskId: "task" } });
});
it.each(["draft-pr", "verify", "fix"] as const)("keeps the checkout during %s", async (phase) => {
  record.auto!.phase = phase;
  await cleanupFinishedAutoWork("task", "/notes", vi.fn());
  expect(mocks.cleanup).not.toHaveBeenCalled();
});
it("keeps a checkout whose QA has not finished", async () => {
  record.auto!.verify = { reviewDone: true };
  await cleanupFinishedAutoWork("task", "/notes", vi.fn());
  expect(mocks.cleanup).not.toHaveBeenCalled();
});
it("keeps the main checkout and missing checkouts", async () => {
  record.auto!.work!.worktree = undefined;
  await cleanupFinishedAutoWork("task", "/notes", vi.fn());
  expect(mocks.cleanup).not.toHaveBeenCalled();
});
it("does not mutate saved metadata during a dry run", async () => {
  await cleanupFinishedAutoWork("task", "/notes", vi.fn(), true);
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(mocks.cleanup).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ dryRun: true }));
});
it("reports errors without marking failed cleanup complete", async () => {
  mocks.cleanup.mockResolvedValue({ errors: ["Paseo unavailable"] });
  await expect(cleanupFinishedAutoWork("task", "/notes", vi.fn())).rejects.toThrow("Paseo unavailable");
});
