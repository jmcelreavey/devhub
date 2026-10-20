import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock("@/lib/api-utils", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api-utils")>()), requireDashboardAuth: () => ({ ok: true }), withErrorHandler: (handler: unknown) => handler }));
vi.mock("@/lib/tasks/plan-task-agent", () => ({
  planTaskAgent: mocks.plan,
  TaskAgentPlanError: class TaskAgentPlanError extends Error { constructor(message: string, readonly status: number) { super(message); } },
}));
import { TaskAgentPlanError } from "@/lib/tasks/plan-task-agent";
import { POST } from "./route";

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://localhost:1337/api/tasks/agent-runs/plan", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
const body = { taskId: "task-1", date: "2026-10-12" };

beforeEach(() => { vi.clearAllMocks(); mocks.plan.mockResolvedValue({ run: { id: "run-1", state: "queued" } }); });

describe("POST /api/tasks/agent-runs/plan", () => {
  it("starts the plan run and answers 201 with the run, taking the origin from the request", async () => {
    const response = await call(body, { origin: "http://localhost:1337/" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ run: { id: "run-1", state: "queued" } });
    expect(mocks.plan).toHaveBeenCalledExactlyOnceWith({ ...body, origin: "http://localhost:1337", depth: 0 });
  });
  it("prefers an explicit origin and passes the optional agent choices through", async () => {
    await call({ ...body, origin: "http://127.0.0.1:1400", provider: "claude", model: "opus", effort: "high", cwd: "/repos/app", repoName: "acme/app", depth: 1 });
    expect(mocks.plan).toHaveBeenCalledWith({ ...body, origin: "http://127.0.0.1:1400", provider: "claude", model: "opus", effort: "high", cwd: "/repos/app", repoName: "acme/app", depth: 1 });
  });
  it.each([[{ taskId: "", date: "2026-10-12" }], [{ taskId: "task-1", date: "tomorrow" }], [{ ...body, effort: "very high!" }], [{ ...body, origin: "not a url" }], [{ ...body, depth: 99 }], [{ taskId: "../etc/passwd", date: "2026-10-12" }]])("rejects %j without planning", async (bad) => {
    expect((await call(bad)).status).toBe(400);
    expect(mocks.plan).not.toHaveBeenCalled();
  });
  it("turns a plan refusal into its status and message, and lets other errors surface", async () => {
    mocks.plan.mockRejectedValueOnce(new TaskAgentPlanError("This task is already on auto, which plans it itself.", 409));
    const response = await call(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This task is already on auto, which plans it itself." });
    mocks.plan.mockRejectedValueOnce(new Error("boom"));
    await expect(call(body)).rejects.toThrow("boom");
  });
});
