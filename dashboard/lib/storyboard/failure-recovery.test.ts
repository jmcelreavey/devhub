import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard } from "./notes-board-shared";
const mocks = vi.hoisted(() => ({ board: vi.fn(), acknowledge: vi.fn(), retry: vi.fn(), resume: vi.fn(), runs: vi.fn(), raw: vi.fn() }));
vi.mock("./notes-board", () => ({ readNotesBoard: mocks.board }));
vi.mock("./failure-acknowledgements", () => ({ acknowledgeFailure: mocks.acknowledge }));
vi.mock("./orchestrator", () => ({ retryOrchestration: mocks.retry }));
vi.mock("@/lib/tasks/resume-task-agent", () => ({ resumeTaskAgent: mocks.resume }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ listTaskAgentRuns: mocks.runs, isActiveTaskAgentRunStatus: (status: string) => ["running", "queued", "paused"].includes(status) }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: mocks.raw }));
vi.mock("@/lib/notes/dir", () => ({ getNotesDir: () => "/fixture/notes" }));
vi.mock("@/lib/plugins/lock", () => ({ withPluginMutationLock: (_key: string, work: () => Promise<unknown>) => work() }));
import { recoverFailure } from "./failure-recovery";
const card = { taskId: "task", date: "2026-10-18", failure: { key: "failure-1", summary: "Plan failed", runId: "failed" }, run: { runId: "failed", status: "failed" }, steps: [], taskDone: false } as unknown as BoardCard;
beforeEach(() => { vi.clearAllMocks(); mocks.board.mockReturnValue({ cards: [card] }); mocks.runs.mockReturnValue([]); mocks.retry.mockResolvedValue({}); mocks.resume.mockResolvedValue({}); });
describe("failure recovery", () => {
  it("clears and restores only an acknowledgement, without dispatching or deleting history", async () => {
    await recoverFailure({ taskId: "task", key: "failure-1", action: "clear" }, "http://fixture");
    expect(mocks.acknowledge).toHaveBeenCalledWith("task", "failure-1");
    await recoverFailure({ taskId: "task", key: "failure-1", action: "restore" }, "http://fixture");
    expect(mocks.acknowledge).toHaveBeenLastCalledWith("task", null);
    expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("rejects stale failures, foreign tasks and live runs", async () => {
    await expect(recoverFailure({ taskId: "task", key: "old", action: "clear" }, "http://fixture")).rejects.toMatchObject({ status: 409 });
    await expect(recoverFailure({ taskId: "foreign", key: "failure-1", action: "clear" }, "http://fixture")).rejects.toMatchObject({ status: 404 });
    mocks.runs.mockReturnValue([{ runId: "new", status: "running" }]);
    await expect(recoverFailure({ taskId: "task", key: "failure-1", action: "retry" }, "http://fixture")).rejects.toMatchObject({ status: 409 });
    expect(mocks.acknowledge).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("resumes the exact manual run with guidance and its task date", async () => {
    await recoverFailure({ taskId: "task", key: "failure-1", action: "resume", guidance: "Use the saved checkout" }, "http://fixture");
    expect(mocks.resume).toHaveBeenCalledWith({ taskId: "task", date: "2026-10-18", origin: "http://fixture", retryRunId: "failed", guidance: "Use the saved checkout" });
  });
  it("retries auto through its existing phase operation and returns deferred execution", async () => {
    mocks.board.mockReturnValue({ cards: [{ ...card, auto: { phase: "verify", status: "needs-you" } }] });
    const execute = vi.fn(); mocks.retry.mockResolvedValue({ execute });
    expect(await recoverFailure({ taskId: "task", key: "failure-1", action: "resume", guidance: "Retry the review" }, "http://fixture")).toEqual({ execute });
    expect(mocks.retry).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", taskId: "task", guidance: "Retry the review" }), { origin: "http://fixture" });
    expect(execute).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("requires guidance for a guided resume", async () => {
    await expect(recoverFailure({ taskId: "task", key: "failure-1", action: "resume" }, "http://fixture")).rejects.toMatchObject({ status: 400 });
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});
