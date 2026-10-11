import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/accounts", () => ({ credential: (ref: string) => {
  if (ref.endsWith("_ALLOWLIST")) return JSON.stringify([{ channel: "7", user: "7", profile: "work", accounts: ["jira:default"] }, { channel: "8", user: "8", profile: "personal", accounts: ["jira:default"] }]);
  return "example-secret-never-returned-in-status";
} }));
vi.mock("@/lib/integrations/alert-worker", () => ({ alertProfile: () => "work" }));
import { GET } from "./route";
afterEach(() => vi.unstubAllEnvs());
describe("read-only chat-command configuration", () => {
  it("reports only active-profile counts and variable names, never values or allowlist identities", async () => {
    vi.stubEnv("DEVHUB_TELEGRAM_COMMANDS", "1"); vi.stubEnv("DEVHUB_SLACK_COMMANDS", "0");
    const response = await GET(new NextRequest("http://localhost:1350/api/integrations/chat/config", { headers: { host: "localhost:1350", origin: "http://localhost:1350" } }));
    const result = await response.json();
    expect(result.chat.find((entry: { provider: string }) => entry.provider === "telegram")).toMatchObject({ enabled: true, configured: true, allowed: 1, secretVariable: "DEVHUB_TELEGRAM_WEBHOOK_SECRET", webhookPath: "/api/integrations/chat/telegram" });
    expect(result.profile).toBe("work"); expect(JSON.stringify(result)).not.toMatch(/example-secret|personal|"user"|"channel"/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("requires dashboard authentication", async () => {
    expect((await GET(new NextRequest("http://localhost:1350/api/integrations/chat/config"))).status).toBeGreaterThanOrEqual(400);
  });
});
