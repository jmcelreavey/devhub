import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/slack/usage-log", () => ({ slackUsageTotals: vi.fn() }));
import { slackUsageTotals } from "@/lib/integrations/slack/usage-log";
import { GET } from "./route";

const origin = "http://localhost:1350";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DEVHUB_API_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("GET Slack usage", () => {
  it("returns today's totals without caching", async () => {
    vi.mocked(slackUsageTotals).mockReturnValue({ date: "2026-10-18", queries: 3, rules: 2, jevCalls: 1, jevCostUsd: 0.0001, modelCalls: 0 });
    const response = await GET(new NextRequest(origin + "/api/integrations/slack/usage", { headers: { host: "localhost:1350", referer: origin + "/setup" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ queries: 3, jevCalls: 1 });
  });
  it("rejects unauthenticated reads", async () => {
    expect((await GET(new NextRequest(origin + "/api/integrations/slack/usage"))).status).toBe(403);
    expect(slackUsageTotals).not.toHaveBeenCalled();
  });
  it("never returns raw failures", async () => {
    vi.mocked(slackUsageTotals).mockImplementation(() => { throw new Error("private-path"); });
    const response = await GET(new NextRequest(origin + "/api/integrations/slack/usage", { headers: { host: "localhost:1350", origin } }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-path");
  });
});
