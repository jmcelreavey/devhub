import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/slack/test-message", () => ({ sendSlackTest: vi.fn() }));
import { sendSlackTest } from "@/lib/integrations/slack/test-message";
import { IntegrationError } from "@/lib/integrations/types";
import { POST } from "./route";

const origin = "http://localhost:1350";
const input = { requestId: "11111111-1111-4111-8111-111111111111", revision: "a".repeat(64) };
function request(body: unknown, source = origin) {
  return new NextRequest(origin + "/api/integrations/slack/test", { method: "POST", headers: { host: "localhost:1350", ...(source ? { origin: source } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DEVHUB_API_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("POST Slack test", () => {
  it("requires dashboard authentication before sending", async () => {
    vi.stubEnv("DEVHUB_API_SECRET", "private-dashboard-secret");
    expect((await POST(request(input, ""))).status).toBe(401);
    expect(sendSlackTest).not.toHaveBeenCalled();
  });
  it("sends only the revision-bound fixed test", async () => {
    vi.mocked(sendSlackTest).mockResolvedValue({ state: "sent", detail: "Sent." });
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivery: { state: "sent", detail: "Sent." } });
    expect(sendSlackTest).toHaveBeenCalledExactlyOnceWith(input);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["", "https://other.test"])("rejects non-dashboard sends: %s", async (source) => {
    expect((await POST(request(input, source))).status).toBe(403);
    expect(sendSlackTest).not.toHaveBeenCalled();
  });
  it.each([{ ...input, revision: "bad" }, { ...input, channel: "COTHER" }, { ...input, text: "arbitrary content" }, { revision: input.revision }])("rejects invalid tests", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(sendSlackTest).not.toHaveBeenCalled();
  });
  it("preserves conflict errors without retrying", async () => {
    vi.mocked(sendSlackTest).mockRejectedValue(new IntegrationError("conflict", "Settings changed."));
    expect((await POST(request(input))).status).toBe(409);
    expect(sendSlackTest).toHaveBeenCalledTimes(1);
  });
  it("reports unknown outcomes without claiming success", async () => {
    vi.mocked(sendSlackTest).mockResolvedValue({ state: "unknown", detail: "Check the channel." });
    expect(await (await POST(request(input))).json()).toEqual({ delivery: { state: "unknown", detail: "Check the channel." } });
  });
  it("never exposes or logs unexpected errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(sendSlackTest).mockRejectedValue(new Error("private-token"));
      const response = await POST(request(input));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private-token");
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
