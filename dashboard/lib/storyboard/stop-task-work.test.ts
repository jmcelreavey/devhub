import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runs: vi.fn(), raw: vi.fn(), cancel: vi.fn(), managedCancel: vi.fn(), reconcile: vi.fn(), mutate: vi.fn(), upsert: vi.fn(), auto: vi.fn() }));
vi.mock("./orchestration-store", () => ({ readOrchestration: mocks.auto, mutateOrchestration: mocks.mutate }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ listTaskAgentRuns: mocks.runs, isActiveTaskAgentRunStatus: (status: string) => ["queued", "running"].includes(status), upsertTaskAgentRun: mocks.upsert }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: mocks.raw, cancelAgentRun: mocks.cancel, reconcileAgentRun: mocks.reconcile }));
vi.mock("@/lib/paseo/lifecycle", () => ({ cancelManagedRun: mocks.managedCancel, reconcileManagedRun: mocks.reconcile }));
import { stopTaskWork } from "./stop-task-work";

beforeEach(() => { vi.clearAllMocks(); mocks.auto.mockReturnValue({ status: "running" }); });

describe("stopTaskWork", () => {
  it("pauses auto, stops a live local run through its runtime and marks it abandoned", async () => {
    mocks.runs.mockReturnValue([{ runId: "run", status: "running" }]);
    const run = { spec: { runtime: "local" }, status: { state: "running" } };
    mocks.raw.mockReturnValue(run);
    mocks.reconcile.mockReturnValue({ ...run, status: { state: "cancelled" } });
    await stopTaskWork("task");
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledWith(run);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task", status: "abandoned" }));
  });
  it("refuses, without marking the run abandoned, when it will not stop", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mocks.runs.mockReturnValue([{ runId: "run", status: "running" }]);
    const run = { spec: { runtime: "local" }, status: { state: "running" } };
    mocks.raw.mockReturnValue(run);
    mocks.reconcile.mockImplementation(() => { vi.setSystemTime(Date.now() + 20_000); return run; });
    await expect(stopTaskWork("task")).rejects.toThrow("still running");
    expect(mocks.upsert).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
