import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./accounts", () => ({ credential: vi.fn(() => "123456:abcdefghijklmnopqrstuvwxyz") }));
import { credential } from "./accounts";
import { discoverTelegramChats } from "./telegram";

function response(result: unknown, status = 200) { return new Response(JSON.stringify({ ok: status === 200, result, error_code: status === 200 ? undefined : status }), { status }); }
afterEach(() => vi.restoreAllMocks());
describe("server-side Telegram chat discovery", () => {
  it("returns only numeric IDs and type, newest first, without acknowledging updates", async () => {
    const message = (id: number, type = "private") => ({ chat: { id, type, title: "Private title" }, from: { id: 7, is_bot: false, first_name: "Private name" }, text: "Private message" });
    const fetcher = vi.fn().mockResolvedValueOnce(response({ url: "" })).mockResolvedValueOnce(response([
      { message: message(7) }, { channel_post: message(-100123, "channel") }, { message: message(7) }, { edited_message: message(8) },
    ]));
    const chats = await discoverTelegramChats("BOT", fetcher);
    expect(chats).toEqual([{ chatId: "7", type: "private", userId: "7" }, { chatId: "-100123", type: "channel", userId: "7" }]);
    expect(JSON.stringify(chats)).not.toMatch(/Private|abcdefghijklmnopqrstuvwxyz/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toMatch(/\/getUpdates$/);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ limit: 100, timeout: 0 });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: "error", method: "POST" });
  });
  it("never polls or removes an active webhook and never returns its URL", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ url: "https://private.test/token-secret" }));
    await expect(discoverTelegramChats("BOT", fetcher)).rejects.toMatchObject({ kind: "conflict", message: expect.not.stringContaining("token-secret") });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toMatch(/\/getWebhookInfo$/);
  });
  it("returns an empty list when no pending messages exist", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ url: "" })).mockResolvedValueOnce(response([]));
    expect(await discoverTelegramChats("BOT", fetcher)).toEqual([]);
  });
  it.each([401, 403, 409, 429, 500])("sanitises provider rejection %s without logging or retry", async (status) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error_code: status, description: "secret-token private-text" }), { status }));
    await expect(discoverTelegramChats("BOT", fetcher)).rejects.toMatchObject({ message: expect.not.stringMatching(/secret-token|private-text/) });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled();
  });
  it("sanitises token-bearing fetch errors, malformed responses and unsafe IDs", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("bot123456:abcdefghijklmnopqrstuvwxyz"));
    await expect(discoverTelegramChats("BOT", fetcher)).rejects.toMatchObject({ message: expect.not.stringContaining("abcdefghijklmnopqrstuvwxyz") });
    fetcher.mockReset().mockResolvedValue(new Response("not json"));
    await expect(discoverTelegramChats("BOT", fetcher)).rejects.toMatchObject({ kind: "unavailable" });
    fetcher.mockReset().mockResolvedValueOnce(response({ url: "" })).mockResolvedValueOnce(response([{ message: { chat: { id: Number.MAX_SAFE_INTEGER + 1, type: "private" } } }]));
    await expect(discoverTelegramChats("BOT", fetcher)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("rejects malformed tokens before any network request", async () => {
    vi.mocked(credential).mockReturnValueOnce("not-a-bot-token"); const fetcher = vi.fn();
    await expect(discoverTelegramChats("BOT", fetcher)).rejects.toMatchObject({ kind: "invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
