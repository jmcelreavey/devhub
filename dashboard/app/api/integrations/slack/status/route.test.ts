import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/slack/runtime", () => ({ slackStatus: vi.fn() }));
import { slackStatus } from "@/lib/integrations/slack/runtime";
import { GET } from "./route";

const origin = "http://localhost:1350";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DEVHUB_API_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("GET Slack status", () => {
  it("returns masked status without caching or starting a connection", async () => {
    vi.mocked(slackStatus).mockReturnValue({ configured: false, settings: { botToken: "••••••••", appToken: "••••••••", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "" }, revision: "a".repeat(64), profile: "work", connection: { state: "not-configured", message: "Not connected" } });
    const response = await GET(new NextRequest(origin + "/api/integrations/slack/status", { headers: { host: "localhost:1350", referer: origin + "/setup" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ settings: { botToken: "••••••••", appToken: "••••••••" }, profile: "work" });
    expect(slackStatus).toHaveBeenCalledTimes(1);
  });
  it("rejects unauthenticated reads", async () => {
    expect((await GET(new NextRequest(origin + "/api/integrations/slack/status"))).status).toBe(403);
    expect(slackStatus).not.toHaveBeenCalled();
  });
  it("never returns or logs raw failures", async () => {
    vi.mocked(slackStatus).mockImplementation(() => { throw new Error("private-token"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await GET(new NextRequest(origin + "/api/integrations/slack/status", { headers: { host: "localhost:1350", origin } }));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private-token");
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
