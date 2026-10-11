import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/write-store", () => ({ requestWrite: vi.fn(async () => ({ id: "b815a214-1d69-4e5a-a912-1c70e9159121", state: "requested" })), reviewWrite: vi.fn(), confirmWrite: vi.fn(), cancelWrite: vi.fn(), listWrites: vi.fn(() => []) }));
vi.mock("@/lib/integrations/alert-worker", () => ({ alertProfile: () => "work" }));
vi.mock("@/lib/integrations/chat", () => ({ chatStatus: () => [] }));
import { POST } from "./route";
import { POST as legacyCreate } from "@/app/api/jira/issue/route";
import { POST as legacyTransition } from "@/app/api/jira/ticket/[key]/transition/route";
import { requestWrite, confirmWrite } from "@/lib/integrations/write-store";
const url = "http://localhost:1337";
function request(body: unknown, origin = url) {
  return new NextRequest(url + "/api/integrations/writes", { method: "POST", headers: { host: "localhost:1337", ...(origin ? { origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  it("legacy Jira creation proposes without executing and keeps all fields", async () => {
    const response = await legacyCreate(request({ projectKey: "APP", summary: "Ticket", description: "Body", parentKey: "APP-1", sprintId: 7, assignToMe: true }));
    expect(response.status).toBe(202); expect(response.headers.get("x-devhub-confirmation")).toBe("required");
    expect(requestWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "issue.create", account: "default", title: "Ticket", body: "Body", parentKey: "APP-1", sprintId: 7 }), "work");
    expect(confirmWrite).not.toHaveBeenCalled();
  });
  it("legacy transitions only propose the named native transition", async () => {
    const response = await legacyTransition(request({ transitionId: "31" }), { params: Promise.resolve({ key: "APP-1" }) });
    expect(response.status).toBe(202);
    expect(requestWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "issue.transition", ref: { provider: "jira", account: "default", kind: "issue", id: "APP-1" }, transitionId: "31" }), "work");
    expect(confirmWrite).not.toHaveBeenCalled();
  });
});
