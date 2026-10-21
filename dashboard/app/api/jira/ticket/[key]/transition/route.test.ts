import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ active: "work", write: vi.fn(), transitions: vi.fn(), queue: vi.fn(), taskIds: vi.fn(() => ["task-1"]) }));
vi.mock("@/lib/tasks/ready-linked-prs", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/tasks/ready-linked-prs")>(), queueReadyLinkedDraftPrs: state.queue, taskIdsForJiraKey: state.taskIds }));
vi.mock("@shared/vault/task-profiles.ts", () => ({ resolveActiveProfileId: () => state.active }));
vi.mock("@/lib/notes/dir", () => ({ getTasksDir: () => "/tmp/home-jira" }));
vi.mock("@/lib/tasks/profiles", () => ({ getTaskProfileOverview: () => ({ active: "work" }) }));
vi.mock("@/lib/integrations/write-store", () => ({ writeNow: state.write }));
vi.mock("@/lib/integrations/registry", () => ({ providerFor: () => ({ transitions: state.transitions }) }));
import { POST } from "./route";
function request(profile?: string, body = { transitionId: "1" } as object) {
  return new NextRequest("http://localhost/api/jira/ticket/APP-1/transition", { method: "POST", headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", "x-devhub-intent": "direct", ...(profile ? { "x-devhub-task-profile": profile } : {}) }, body: JSON.stringify(body) });
}
const context = { params: Promise.resolve({ key: "APP-1" }) };
beforeEach(() => { vi.clearAllMocks(); state.active = "work"; state.write.mockResolvedValue({ result: { state: "succeeded", prepared: { details: {} } }, timings: {} }); });
describe("Home Jira transitions", () => {
  it("refuses stale-profile transitions before any integration write", async () => {
    expect((await POST(request("home"), context)).status).toBe(409);
    expect(state.write).not.toHaveBeenCalled();
  });
  it("rechecks the profile after loading an Undo transition", async () => {
    state.transitions.mockImplementation(async () => { state.active = "home"; return [{ id: "1", statusId: "2" }]; });
    expect((await POST(request("work", { toStatusId: "2" }), context)).status).toBe(409);
    expect(state.write).not.toHaveBeenCalled();
  });
  it("keeps the existing unscoped human action behaviour", async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(state.write).toHaveBeenCalledOnce();
  });
  it("applies an MCP transition immediately without a proposal", async () => {
    const req = request();
    req.headers.delete("x-devhub-intent");
    req.headers.set("x-devhub-client", "mcp");
    const response = await POST(req, context);
    expect(response.status).toBe(200);
    expect(response.headers.has("x-devhub-confirmation")).toBe(false);
    expect(state.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "issue.transition" }), "work", expect.anything(), { source: "MCP" });
    expect(await response.json()).toMatchObject({ key: "APP-1", ok: true });
  });
  it("marks the ticket's task draft PRs ready when it moves to Code Review", async () => {
    state.write.mockResolvedValue({ result: { state: "succeeded", prepared: { details: { from: "In Progress", to: "Code Review" } } }, timings: {} });
    expect((await POST(request(), context)).status).toBe(200);
    expect(state.taskIds).toHaveBeenCalledWith("APP-1");
    expect(state.queue).toHaveBeenCalledExactlyOnceWith("task-1", "APP-1 moved to Code Review");
  });
  it("leaves PRs alone for other statuses and failed transitions", async () => {
    state.write.mockResolvedValue({ result: { state: "succeeded", prepared: { details: { to: "In Progress" } } }, timings: {} });
    await POST(request(), context);
    state.write.mockResolvedValue({ result: { state: "failed", detail: "nope", prepared: { details: { to: "Code Review" } } }, timings: {} });
    await POST(request(), context);
    expect(state.queue).not.toHaveBeenCalled();
  });
});
