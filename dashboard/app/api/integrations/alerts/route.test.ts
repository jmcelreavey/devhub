import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/alert-store", () => ({ readAlerts: vi.fn(), saveDestination: vi.fn(), decideDelivery: vi.fn(), sendTestAlert: vi.fn() }));
vi.mock("@/lib/integrations/alert-worker", () => ({ alertProfile: () => "work" }));
import { GET, POST } from "./route";
import { readAlerts, saveDestination, sendTestAlert } from "@/lib/integrations/alert-store";
import { IntegrationError } from "@/lib/integrations/types";
const origin = "http://localhost:1350";
const id = "11111111-1111-4111-8111-111111111111";
const body = { action: "test", id, revision: 1, requestId: id };
function request(method: string, input?: unknown, source = origin) { return new NextRequest(origin + "/api/integrations/alerts", { method, headers: { host: "localhost:1350", ...(source ? { origin: source } : {}), "Content-Type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}) }); }
beforeEach(() => vi.clearAllMocks());
describe("alert listing and test transport", () => {
  it("lists only the active profile without credential hashes", async () => {
    vi.mocked(readAlerts).mockReturnValue({ version: 1, nextSendAt: 0, destinations: [{ id, label: "Work", workProfile: "work", credentialHash: "private-hash" }, { id: "other", workProfile: "personal" }] as ReturnType<typeof readAlerts>["destinations"], outbox: [] });
    const response = await GET(request("GET")); const data = await response.json();
    expect(data.destinations).toHaveLength(1); expect(JSON.stringify(data)).not.toMatch(/private-hash|personal/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("exposes the new kinds and accepts PR details only with explicit same-origin consent", async () => {
    const destination = { id, label: "Team", provider: "slack", workProfile: "work", credentialRef: "SLACK", events: ["pr-reviewed", "pr-ready"], includePrDetails: true, enabled: true };
    const input = { action: "save", destination, revision: 0 };
    for (const consent of [undefined, false]) expect((await POST(request("POST", { ...input, consent }))).status).toBe(400);
    expect((await POST(request("POST", { ...input, consent: true }, "https://other.test"))).status).toBe(403);
    expect(saveDestination).not.toHaveBeenCalled();
    expect((await POST(request("POST", { ...input, consent: true }))).status).toBe(200);
    expect(saveDestination).toHaveBeenCalledExactlyOnceWith(destination, 0, "work");
    vi.mocked(readAlerts).mockReturnValue({ version: 1, nextSendAt: 0, destinations: [], outbox: [] });
    const data = await (await GET(request("GET"))).json();
    expect(data.events).toMatchObject({ "pr-reviewed": "PR got an AI review", "pr-ready": "PR opened / ready for review" });
  });
  it("sends exactly the saved destination/revision/request ID without changing consent", async () => {
    vi.mocked(sendTestAlert).mockResolvedValue({ state: "sent", kind: "test", detail: "Accepted." } as Awaited<ReturnType<typeof sendTestAlert>>);
    const response = await POST(request("POST", body));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ delivery: { state: "sent" } });
    expect(sendTestAlert).toHaveBeenCalledExactlyOnceWith(id, 1, id, "work"); expect(saveDestination).not.toHaveBeenCalled();
  });
  it.each(["", "https://other.test"])("rejects non-dashboard tests: %s", async (source) => {
    expect((await POST(request("POST", body, source))).status).toBeGreaterThanOrEqual(400); expect(sendTestAlert).not.toHaveBeenCalled();
  });
  it.each([{ ...body, revision: 0 }, { ...body, enabled: true }, { ...body, requestId: "not-a-uuid" }])("rejects invalid test payloads", async (input) => {
    expect((await POST(request("POST", input))).status).toBe(400); expect(sendTestAlert).not.toHaveBeenCalled();
  });
  it.each([["conflict", 409], ["rate-limit", 429]] as const)("preserves %s without retry", async (kind, status) => {
    vi.mocked(sendTestAlert).mockRejectedValueOnce(new IntegrationError(kind, "Check this destination."));
    expect((await POST(request("POST", body))).status).toBe(status); expect(sendTestAlert).toHaveBeenCalledTimes(1);
  });
  it("does not expose or log an unexpected error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.mocked(sendTestAlert).mockRejectedValueOnce(new Error("private-token"));
      const response = await POST(request("POST", body));
      expect(await response.text()).not.toContain("private-token"); expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
