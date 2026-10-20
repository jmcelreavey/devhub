import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const direct = { id: "c3a1f7a4-0b52-4a0e-9f0b-2f2b7b0f5e11", state: "succeeded", prepared: { details: { from: "In Progress", to: "Done", ticket: "A ticket", fromStatusId: "3" } } };
vi.mock("@/lib/integrations/write-store", () => ({ requestWrite: vi.fn(async () => ({ id: "b815a214-1d69-4e5a-a912-1c70e9159121", state: "requested" })), reviewWrite: vi.fn(), confirmWrite: vi.fn(), cancelWrite: vi.fn(), listWrites: vi.fn(() => []), writeNow: vi.fn(async () => ({ proposal: direct, timings: { prepare: 12.5, send: 30 } })) }));
vi.mock("@/lib/integrations/alert-worker", () => ({ alertProfile: () => "work" }));
vi.mock("@/lib/integrations/chat", () => ({ chatStatus: () => [] }));
import { POST } from "./route";
import { POST as legacyCreate } from "@/app/api/jira/issue/route";
import { POST as legacyTransition } from "@/app/api/jira/ticket/[key]/transition/route";
import { requestWrite, confirmWrite, writeNow } from "@/lib/integrations/write-store";
const url = "http://localhost:1337";
function request(body: unknown, origin = url, extra: Record<string, string> = {}) {
  return new NextRequest(url + "/api/integrations/writes", { method: "POST", headers: { host: "localhost:1337", ...(origin ? { origin } : {}), "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
}
beforeEach(() => vi.clearAllMocks());
describe("write transport gates", () => {
  it("requires dashboard origin and an explicit confirmation", async () => {
    const body = { action: "confirm", id: "b815a214-1d69-4e5a-a912-1c70e9159121", digest: "a".repeat(64) };
    expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request({ ...body, confirmed: true }, "https://other.test"))).status).toBeGreaterThanOrEqual(400);
    expect((await POST(request({ ...body, confirmed: true }, ""))).status).toBeGreaterThanOrEqual(400);
    expect(confirmWrite).not.toHaveBeenCalled();
  });
  it("accepts an additive taskId on a Jira-create proposal without executing it", async () => {
    const input = { action: "issue.create", provider: "jira", account: "default", projectKey: "PTF", title: "Android login", body: "Fix login", parentKey: "PTF-4891", taskId: "child-task" };
    expect((await POST(request({ action: "propose", input }))).status).toBe(200);
    expect(requestWrite).toHaveBeenCalledWith(expect.objectContaining({ taskId: "child-task", parentKey: "PTF-4891" }), "work", "DevHub");
    expect(confirmWrite).not.toHaveBeenCalled();
    expect(writeNow).not.toHaveBeenCalled();
  });
  it("legacy Jira creation proposes without executing and keeps all fields", async () => {
    const response = await legacyCreate(request({ projectKey: "APP", summary: "Ticket", description: "Body", parentKey: "APP-1", sprintId: 7, assignToMe: true }));
    expect(response.status).toBe(202); expect(response.headers.get("x-devhub-confirmation")).toBe("required");
    expect(requestWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "issue.create", account: "default", title: "Ticket", body: "Body", parentKey: "APP-1", sprintId: 7 }), "work", "DevHub");
    expect(confirmWrite).not.toHaveBeenCalled();
  });
  it("legacy transitions only propose the named native transition", async () => {
    const response = await legacyTransition(request({ transitionId: "31" }), { params: Promise.resolve({ key: "APP-1" }) });
    expect(response.status).toBe(202);
    expect(requestWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "issue.transition", ref: { provider: "jira", account: "default", kind: "issue", id: "APP-1" }, transitionId: "31" }), "work", "DevHub");
    expect(confirmWrite).not.toHaveBeenCalled();
    expect(writeNow).not.toHaveBeenCalled();
  });
  it("labels an MCP caller's proposal so a reviewer can tell it from their own", async () => {
    await legacyTransition(request({ transitionId: "31" }, url, { "x-devhub-client": "mcp", "x-devhub-intent": "direct" }), { params: Promise.resolve({ key: "APP-1" }) });
    expect(requestWrite).toHaveBeenCalledWith(expect.anything(), "work", "MCP");
    expect(writeNow).not.toHaveBeenCalled();
  });
});
describe("direct writes", () => {
  const params = { params: Promise.resolve({ key: "APP-1" }) };
  const click = { "x-devhub-intent": "direct" };
  it("a person's click moves the ticket at once and returns a way back", async () => {
    const response = await legacyTransition(request({ transitionId: "41" }, url, click), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toBe("prepare;dur=12.5, send;dur=30");
    expect(await response.json()).toMatchObject({ ok: true, key: "APP-1", from: "In Progress", to: "Done", undo: { toStatusId: "3", label: "Move back to In Progress" }, proposal: { id: direct.id } });
    expect(writeNow).toHaveBeenCalledWith(expect.objectContaining({ action: "issue.transition", transitionId: "41" }), "work", expect.anything());
    expect(requestWrite).not.toHaveBeenCalled();
  });
  it("never executes for an agent, even one that sends the intent header", async () => {
    for (const extra of [{ "x-devhub-client": "mcp" }, { "x-devhub-secret": "s" }, { "sec-fetch-site": "cross-site" }] as Array<Record<string, string>>) {
      const response = await legacyTransition(request({ transitionId: "41" }, url, { ...click, ...extra }), params);
      expect(response.status).toBe(202);
    }
    expect(writeNow).not.toHaveBeenCalled();
  });
  it("needs the intent header; same-origin alone is not enough", async () => {
    expect((await legacyTransition(request({ transitionId: "41" }), params)).status).toBe(202);
    expect(writeNow).not.toHaveBeenCalled();
  });
  it("the generic endpoint refuses direct writes from agents with 403", async () => {
    const body = { action: "direct", input: { action: "issue.transition", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: "APP-1" }, transitionId: "41" } };
    expect((await POST(request(body, url, { "x-devhub-client": "mcp", ...click }))).status).toBe(403);
    expect((await POST(request(body))).status).toBe(403);
    expect((await POST(request(body, url, click))).status).toBe(200);
    expect(writeNow).toHaveBeenCalledTimes(1);
  });
  it("reports a refused write as a conflict with the recorded outcome", async () => {
    vi.mocked(writeNow).mockResolvedValueOnce({ proposal: { ...direct, state: "failed", detail: "Provider rejected the transition." } as never, timings: {} });
    const response = await legacyTransition(request({ transitionId: "41" }, url, click), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Provider rejected the transition.", outcome: "failed" });
  });
});
