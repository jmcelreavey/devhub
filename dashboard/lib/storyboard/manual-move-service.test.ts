import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard } from "./notes-board-shared";
const mocks = vi.hoisted(() => ({ board: vi.fn(), runs: vi.fn(), raw: vi.fn(), cancel: vi.fn(), managedCancel: vi.fn(), reconcile: vi.fn(), note: vi.fn(), mutate: vi.fn(), upsert: vi.fn(), reopen: vi.fn() }));
vi.mock("./notes-board", () => ({ readNotesBoard: mocks.board }));
vi.mock("@/lib/tasks/reopen-task", () => ({ resolveReopenTask: async () => ({ id: "task", startDate: "2026-10-18" }), reopenTask: mocks.reopen }));
vi.mock("@/lib/notes/dir", () => ({ getActiveTasksDir: () => "/fixture/tasks" }));
vi.mock("@/lib/plugins/lock", () => ({ withPluginMutationLock: (_key: string, work: () => Promise<unknown>) => work() }));
vi.mock("./orchestration-store", () => ({ readOrchestration: () => ({ status: "running" }), mutateOrchestration: mocks.mutate }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ listTaskAgentRuns: mocks.runs, isActiveTaskAgentRunStatus: (status: string) => ["queued", "running"].includes(status), upsertTaskAgentRun: mocks.upsert }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: mocks.raw, cancelAgentRun: mocks.cancel, reconcileAgentRun: mocks.reconcile }));
vi.mock("@/lib/paseo/lifecycle", () => ({ cancelManagedRun: mocks.managedCancel, reconcileManagedRun: mocks.reconcile }));
vi.mock("@/lib/tasks/task-note-sections", () => ({ updateTaskNoteSections: mocks.note }));
import { moveTaskCard } from "./manual-move";
const card = { taskId: "task", status: "in-progress", taskDone: false, run: null, steps: [] } as unknown as BoardCard;
beforeEach(() => { vi.clearAllMocks(); mocks.board.mockReturnValue({ cards: [card] }); mocks.runs.mockReturnValue([]); });

describe("manual move operation", () => {
  it("moves idle work backwards in one request and writes an explicit To do override", async () => {
    expect(await moveTaskCard({ taskId: "task", status: "todo" })).toEqual({ ok: true });
    expect(mocks.note).toHaveBeenCalledExactlyOnceWith({ taskId: "task", date: "2026-10-18" }, { op: "set_status", status: "todo" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("does not move, pause or cancel anything before confirmation", async () => {
    mocks.runs.mockReturnValue([{ runId: "run", status: "running" }]);
    expect(await moveTaskCard({ taskId: "task", status: "todo" })).toEqual({ ok: false, requiresConfirmation: true });
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("stops auto and the owning runtime before writing the backward move", async () => {
    mocks.runs.mockReturnValue([{ runId: "run", status: "running" }]);
    const run = { spec: { runtime: "paseo" }, status: { state: "running" } };
    mocks.raw.mockReturnValue(run);
    mocks.reconcile.mockResolvedValue({ ...run, status: { state: "cancelled" } });
    expect(await moveTaskCard({ taskId: "task", status: "todo", stopActive: true })).toEqual({ ok: true });
    expect(mocks.managedCancel).toHaveBeenCalledWith(run);
    expect(mocks.mutate.mock.invocationCallOrder[0]).toBeLessThan(mocks.managedCancel.mock.invocationCallOrder[0]);
    expect(mocks.managedCancel.mock.invocationCallOrder[0]).toBeLessThan(mocks.note.mock.invocationCallOrder[0]);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task", status: "abandoned" }));
  });
  it("keeps the card and its notes in place if stopping fails", async () => {
    mocks.runs.mockReturnValue([{ runId: "run", status: "running" }]);
    mocks.raw.mockReturnValue({ spec: { runtime: "paseo" }, status: { state: "running" } });
    mocks.managedCancel.mockRejectedValueOnce(new Error("Runtime unavailable"));
    await expect(moveTaskCard({ taskId: "task", status: "todo", stopActive: true })).rejects.toThrow("Runtime unavailable");
    expect(mocks.note).not.toHaveBeenCalled();
  });
});
