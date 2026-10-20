import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/api-utils", async (original) => ({ ...await original<typeof import("@/lib/api-utils")>(), requireDashboardAuth: () => ({ ok: true }) }));
const mock = vi.hoisted(() => ({ readAgentRun: vi.fn(), clearManagedRun: vi.fn() }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: mock.readAgentRun, toAgentRunSummary: (run: { spec: { id: string }; status: { state: string } }) => ({ id: run.spec.id, state: run.status.state }) }));
vi.mock("@/lib/paseo/lifecycle", () => ({ clearManagedRun: mock.clearManagedRun }));
import { POST } from "./route";

const run = (runtime: string, state = "needs-attention") => ({ spec: { id: "run-1", runtime }, status: { state } });
const post = () => POST(new NextRequest("http://localhost/api/agent/runs/run-1/clear", { method: "POST" }), { params: Promise.resolve({ id: "run-1" }) });
beforeEach(() => vi.clearAllMocks());

describe("POST /api/agent/runs/[id]/clear", () => {
  it("404s an unknown run", async () => {
    mock.readAgentRun.mockReturnValue(null);
    expect((await post()).status).toBe(404);
  });

  it("only clears Paseo runs", async () => {
    mock.readAgentRun.mockReturnValue(run("generation", "running"));
    expect((await post()).status).toBe(409);
    expect(mock.clearManagedRun).not.toHaveBeenCalled();
  });

  it("refuses a run that is still working", async () => {
    const live = run("paseo", "running");
    mock.readAgentRun.mockReturnValue(live);
    mock.clearManagedRun.mockResolvedValue({ run: live, outcome: "still-running" });
    expect((await post()).status).toBe(409);
  });

  it("clears a stale run", async () => {
    mock.readAgentRun.mockReturnValue(run("paseo"));
    mock.clearManagedRun.mockResolvedValue({ run: run("paseo", "cancelled"), outcome: "cleared" });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run: { id: "run-1", state: "cancelled" }, outcome: "cleared" });
  });
});
