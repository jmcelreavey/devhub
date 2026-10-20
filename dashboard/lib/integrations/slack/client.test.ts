import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webOptions: [] as unknown[],
  socketOptions: undefined as unknown,
  events: new Map<string, (event?: unknown) => void>(),
  authenticate: vi.fn(), postMessage: vi.fn(), updateMessage: vi.fn(), publish: vi.fn(), open: vi.fn(), start: vi.fn(), disconnect: vi.fn(),
}));
vi.mock("@slack/web-api", () => ({
  LogLevel: { ERROR: "error" },
  WebClient: class {
    constructor(_token: string, options: unknown) { mocks.webOptions.push(options); }
    auth = { test: mocks.authenticate };
    chat = { postMessage: mocks.postMessage, update: mocks.updateMessage };
    views = { publish: mocks.publish, open: mocks.open };
  },
}));
vi.mock("@slack/socket-mode", () => ({
  SocketModeClient: class {
    constructor(options: unknown) { mocks.socketOptions = options; }
    on(event: string, listener: (event?: unknown) => void) { mocks.events.set(event, listener); }
    start = mocks.start;
    disconnect = mocks.disconnect;
  },
}));
import { classifySlackFailure, createSlackClient, SlackNotSentError, slackErrorMessage, withSlackRetry } from "./client";

const settings = { botToken: "xoxb-fake", appToken: "xapp-private-app", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.events.clear(); mocks.webOptions.length = 0;
  mocks.authenticate.mockResolvedValue({ ok: true, user_id: "UBOT", user: "DevHub", team_id: "TTEAM" });
  mocks.postMessage.mockResolvedValue({ ok: true, channel: "CCHANNEL", ts: "123.456" });
});

describe("injectable Slack SDK adapter", () => {
  it("leaves reconnects to the SDK, retries safe calls there, and keeps posts out of the SDK's blind retries", async () => {
    const client = createSlackClient(settings);
    expect(mocks.socketOptions).toMatchObject({ appToken: settings.appToken, autoReconnectEnabled: true });
    const [safe, poster] = mocks.webOptions;
    expect(safe).toMatchObject({ timeout: 10000, retryConfig: { retries: 3 }, rejectRateLimitedCalls: false });
    expect(poster).toMatchObject({ timeout: 10000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
    expect(await client.authenticate()).toEqual({ userId: "UBOT", name: "DevHub", teamId: "TTEAM" });
    await client.start(); await client.stop(); await client.postMessage({ channel: "CCHANNEL", text: "test" });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.postMessage).toHaveBeenCalledExactlyOnceWith({ channel: "CCHANNEL", text: "test" });
  });
  it("passes envelope IDs, event bodies and acknowledgements through unchanged", async () => {
    const client = createSlackClient(settings);
    const listener = vi.fn(async () => {});
    const ack = vi.fn(async () => {});
    client.onEnvelope(listener);
    mocks.events.get("slack_event")?.({ envelope_id: "env-1", type: "events_api", body: { event_id: "Ev1" }, ack });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ envelopeId: "env-1", type: "events_api", body: { event_id: "Ev1" }, acknowledge: ack });
  });
  it("opens revision modals with their interaction trigger and broadcasts DM replies only on posts", async () => {
    const client = createSlackClient(settings);
    const view = { type: "modal" as const, title: { type: "plain_text" as const, text: "Revise plan" }, blocks: [] };
    await client.openModal!("trigger-one", view);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ trigger_id: "trigger-one", view });
    await client.postMessage({ channel: "DOWNER", text: "Waiting for you", thread_ts: "1.1", reply_broadcast: true });
    expect(mocks.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ reply_broadcast: true }));
    await client.updateMessage({ channel: "DOWNER", text: "Resolved", ts: "1.2", thread_ts: "1.1", reply_broadcast: true });
    expect(mocks.updateMessage).toHaveBeenLastCalledWith({ channel: "DOWNER", text: "Resolved", ts: "1.2" });
  });
  it("returns the receipt and updates a message without resending it as a thread reply", async () => {
    const client = createSlackClient(settings);
    expect(await client.postMessage({ channel: "CCHANNEL", text: "needs you" })).toEqual({ channel: "CCHANNEL", ts: "123.456" });
    await client.updateMessage({ channel: "CCHANNEL", text: "Answered", ts: "123.456", thread_ts: "123.456" });
    expect(mocks.updateMessage).toHaveBeenCalledExactlyOnceWith({ channel: "CCHANNEL", text: "Answered", ts: "123.456" });
    await client.postMessage({ channel: "CCHANNEL", text: "card", taskRef: { profile: "work", taskId: "t1", title: "A task" } });
    expect(mocks.postMessage).toHaveBeenLastCalledWith({ channel: "CCHANNEL", text: "card" });
    await client.updateMessage({ channel: "CCHANNEL", text: "edit", ts: "1.1", taskRef: { profile: "work", taskId: "t1", title: "A task" } });
    expect(mocks.updateMessage).toHaveBeenLastCalledWith({ channel: "CCHANNEL", text: "edit", ts: "1.1" });
    mocks.postMessage.mockResolvedValue({ ok: true });
    await expect(client.postMessage({ channel: "CCHANNEL", text: "missing receipt" })).rejects.toThrow("Missing Slack message receipt");
    await client.publishHome("UOWNER", { type: "home", blocks: [] });
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({ user_id: "UOWNER", view: { type: "home", blocks: [] } });
  });
  it("observes connection transitions and SDK errors without logging the error", () => {
    const client = createSlackClient(settings);
    const listener = vi.fn();
    client.onState(listener);
    mocks.events.get("reconnecting")?.();
    expect(listener).toHaveBeenLastCalledWith("reconnecting");
    mocks.events.get("error")?.(new Error("private-token"));
    expect(listener).toHaveBeenLastCalledWith("error", expect.any(Error));
    const options = mocks.webOptions[0] as { logger: { error: (message: string) => void } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { options.logger.error("private-token"); expect(log).not.toHaveBeenCalled(); }
    finally { log.mockRestore(); }
  });
  it("rejects incomplete authentication responses", async () => {
    mocks.authenticate.mockResolvedValue({ ok: true, user_id: "UBOT" });
    await expect(createSlackClient(settings).authenticate()).rejects.toThrow("Invalid Slack identity");
  });
  it.each([
    ["invalid_auth", "Slack rejected the token"], ["not_in_channel", "Invite @DevHub"], ["missing_scope", "Reinstall the Slack app"], ["ratelimited", "slow down"],
  ])("maps %s to safe recovery instructions", (code, hint) => {
    const message = slackErrorMessage({ data: { error: code }, message: "private-token" });
    expect(message).toContain(hint);
    expect(message).not.toContain("private-token");
  });
});

const rateLimited = (seconds: number) => Object.assign(new Error("rate limited"), { code: "slack_webapi_rate_limited_error", retryAfter: seconds });
const requestError = (code: string, via: "original" | "cause" = "original") => Object.assign(new Error("request failed"), { code: "slack_webapi_request_error", original: via === "original" ? Object.assign(new Error("fetch failed"), { cause: { code } }) : { code } });

describe("classifying a failed Slack call", () => {
  it("reads Retry-After from the SDK error, an HTTP 429 and a platform ratelimited error", () => {
    expect(classifySlackFailure(rateLimited(7))).toEqual({ kind: "rate-limited", retryAfterMs: 7000 });
    expect(classifySlackFailure(Object.assign(new Error("x"), { code: "slack_webapi_http_error", statusCode: 429, headers: { "retry-after": "12" } }))).toEqual({ kind: "rate-limited", retryAfterMs: 12000 });
    expect(classifySlackFailure(Object.assign(new Error("x"), { code: "slack_webapi_platform_error", data: { error: "ratelimited", response_metadata: { retryAfter: 3 } } }))).toEqual({ kind: "rate-limited", retryAfterMs: 3000 });
    expect(classifySlackFailure(rateLimited(0))).toEqual({ kind: "rate-limited", retryAfterMs: 1000 });
  });
  it.each(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"])("treats %s (DNS / no route) as not sent", (code) => {
    expect(classifySlackFailure(requestError(code))).toEqual({ kind: "not-sent" });
    expect(classifySlackFailure(requestError(code, "cause"))).toEqual({ kind: "not-sent" });
  });
  it("treats a reset, a timeout and a Slack-side error as an unknown outcome", () => {
    expect(classifySlackFailure(requestError("ECONNRESET"))).toEqual({ kind: "uncertain" });
    expect(classifySlackFailure(requestError("ETIMEDOUT"))).toEqual({ kind: "uncertain" });
    expect(classifySlackFailure(Object.assign(new Error("x"), { code: "slack_webapi_platform_error", data: { error: "channel_not_found" } }))).toEqual({ kind: "uncertain" });
    expect(classifySlackFailure(new Error("anything else"))).toEqual({ kind: "uncertain" });
    expect(classifySlackFailure(undefined)).toEqual({ kind: "uncertain" });
  });
  it("knows a send we stopped ourselves was never sent", () => expect(classifySlackFailure(new SlackNotSentError("stopped"))).toEqual({ kind: "not-sent" }));
});

describe("retrying a post", () => {
  it("waits out a 429's Retry-After, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn().mockRejectedValueOnce(rateLimited(7)).mockRejectedValueOnce(rateLimited(2)).mockResolvedValue("ok");
    expect(await withSlackRetry(send, { sleep })).toBe("ok");
    expect(sleep.mock.calls).toEqual([[7000], [2000]]);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("retries a DNS failure with growing backoff", async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn().mockRejectedValueOnce(requestError("ENOTFOUND")).mockRejectedValueOnce(requestError("EAI_AGAIN")).mockResolvedValue("ok");
    expect(await withSlackRetry(send, { sleep })).toBe("ok");
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });
  it("never repeats a post whose outcome is unknown", async () => {
    const sleep = vi.fn(async () => {});
    const failure = requestError("ECONNRESET");
    const send = vi.fn().mockRejectedValue(failure);
    await expect(withSlackRetry(send, { sleep })).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("gives up loudly, with the original error, after the last attempt or an over-long Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn().mockRejectedValue(rateLimited(1));
    await expect(withSlackRetry(send, { sleep, attempts: 3 })).rejects.toMatchObject({ code: "slack_webapi_rate_limited_error" });
    expect(send).toHaveBeenCalledTimes(3);
    const slow = vi.fn().mockRejectedValue(rateLimited(300));
    await expect(withSlackRetry(slow, { sleep, maxWaitMs: 60_000 })).rejects.toMatchObject({ retryAfter: 300 });
    expect(slow).toHaveBeenCalledTimes(1);
  });
  it("is what the client's postMessage uses", async () => {
    mocks.postMessage.mockRejectedValueOnce(rateLimited(2)).mockResolvedValue({ ok: true, channel: "CCHANNEL", ts: "9.9" });
    const sleep = vi.fn(async () => {});
    expect(await createSlackClient(settings, { sleep }).postMessage({ channel: "CCHANNEL", text: "hi" })).toEqual({ channel: "CCHANNEL", ts: "9.9" });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(mocks.postMessage).toHaveBeenCalledTimes(2);
  });
});
