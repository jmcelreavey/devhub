import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ active: "work", write: vi.fn(), transitions: vi.fn(), propose: vi.fn() }));
vi.mock("@shared/vault/task-profiles.ts", () => ({ resolveActiveProfileId: () => state.active }));
vi.mock("@/lib/notes/dir", () => ({ getTasksDir: () => "/tmp/home-jira" }));
vi.mock("@/lib/integrations/alert-worker", () => ({ alertProfile: () => "work" }));
vi.mock("@/lib/integrations/write-store", () => ({ writeNow: state.write, requestWrite: state.propose }));
vi.mock("@/lib/integrations/registry", () => ({ providerFor: () => ({ transitions: state.transitions }) }));
import { POST } from "./route";
function request(profile?: string, body = { transitionId: "1" } as object) {
  return new NextRequest("http://localhost/api/jira/ticket/APP-1/transition", { method: "POST", headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", "x-devhub-intent": "direct", ...(profile ? { "x-devhub-task-profile": profile } : {}) }, body: JSON.stringify(body) });
}
const context = { params: Promise.resolve({ key: "APP-1" }) };
beforeEach(() => { vi.clearAllMocks(); state.active = "work"; state.write.mockResolvedValue({ proposal: { state: "succeeded", prepared: { details: {} } }, timings: {} }); });
describe("Home Jira transitions", () => {
  it("refuses stale-profile transitions before any integration write", async () => {
    expect((await POST(request("home"), context)).status).toBe(409);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.propose).not.toHaveBeenCalled();
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
});
