import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/telegram", () => ({ discoverTelegramChats: vi.fn() }));
import { POST } from "./route";
import { discoverTelegramChats } from "@/lib/integrations/telegram";
import { IntegrationError } from "@/lib/integrations/types";
const origin = "http://localhost:1350";
function request(body: unknown, source = origin) { return new NextRequest(origin + "/api/integrations/telegram/chats", { method: "POST", headers: { host: "localhost:1350", ...(source ? { origin: source } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => vi.clearAllMocks());
describe("Telegram discovery transport", () => {
  it("accepts only a server credential reference and returns no-store IDs", async () => {
    vi.mocked(discoverTelegramChats).mockResolvedValueOnce([{ chatId: "7", type: "private", userId: "7" }]);
    const response = await POST(request({ credentialRef: "DEVHUB_TELEGRAM_TOKEN" }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ chats: [{ chatId: "7", type: "private", userId: "7" }] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(discoverTelegramChats).toHaveBeenCalledExactlyOnceWith("DEVHUB_TELEGRAM_TOKEN");
  });
  it.each(["", "https://other.test"])("refuses unauthorised discovery: %s", async (source) => {
    expect((await POST(request({ credentialRef: "BOT" }, source))).status).toBeGreaterThanOrEqual(400); expect(discoverTelegramChats).not.toHaveBeenCalled();
  });
  it.each([{ credentialRef: "123456:abcdefghijklmnopqrstuvwxyz" }, { credentialRef: "BOT", token: "private" }, { credentialRef: "BOT", offset: -1 }])("refuses tokens or polling options in the request", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(discoverTelegramChats).not.toHaveBeenCalled();
  });
  it("preserves active-webhook conflict and sanitises unexpected errors", async () => {
    vi.mocked(discoverTelegramChats).mockRejectedValueOnce(new IntegrationError("conflict", "Webhook already active."));
    expect((await POST(request({ credentialRef: "BOT" }))).status).toBe(409);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.mocked(discoverTelegramChats).mockRejectedValueOnce(new Error("private-token"));
      expect(await (await POST(request({ credentialRef: "BOT" }))).text()).not.toContain("private-token"); expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
