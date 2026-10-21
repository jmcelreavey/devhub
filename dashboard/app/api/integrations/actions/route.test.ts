import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@/lib/tasks/profiles", () => ({ getTaskProfileOverview: () => ({ active: "work" }) }));
vi.mock("@/lib/integrations/write-store", () => ({ writeNow: state.write }));
import { POST } from "./route";
const input = { action: "issue.create", provider: "jira", account: "default", projectKey: "APP", title: "Fix checkout", body: "Check retries." };
function request(body: unknown = input, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/integrations/actions", { method: "POST", headers: { host: "localhost", origin, "content-type": "application/json", "x-devhub-client": "mcp" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.write.mockResolvedValue({ result: { state: "succeeded" }, timings: {} });
});
describe("direct integration actions", () => {
  it("executes an MCP action once and returns its outcome", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { state: "succeeded" } });
    expect(state.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(input), "work", expect.any(AbortSignal));
  });
  it("rejects cross-origin and invalid actions before execution", async () => {
    expect((await POST(request(input, "https://other.example"))).status).toBe(403);
    expect((await POST(request({ ...input, action: "confirm" }))).status).toBe(400);
    expect(state.write).not.toHaveBeenCalled();
  });
  it("reports uncertain writes without retrying or claiming success", async () => {
    state.write.mockResolvedValue({ result: { state: "unknown", detail: "Check Jira before retrying." }, timings: {} });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Check Jira before retrying.", outcome: "unknown" });
    expect(state.write).toHaveBeenCalledOnce();
  });
});
