import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSlackTest } from "./test-message";
import { slackSettingsRevision } from "./settings";
import type { SlackClient } from "./client";

const settings = { botToken: "xoxb-fake", appToken: "xapp-private-app", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM" };
const input = { revision: slackSettingsRevision(settings), requestId: "11111111-1111-4111-8111-111111111111" };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-test-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
function setup() {
  const client: SlackClient = {
    authenticate: vi.fn(async () => ({ userId: "UBOT", name: "DevHub", teamId: "TTEAM" })),
    start: vi.fn(async () => {}), stop: vi.fn(async () => {}), postMessage: vi.fn(async () => ({ channel: "CCHANNEL", ts: "123.456" })), updateMessage: vi.fn(async () => {}), publishHome: vi.fn(async () => {}), onEnvelope: vi.fn(), onState: vi.fn(),
  };
  return { client, options: { root, settings, profile: "work", createClient: vi.fn(() => client), wait: vi.fn(async () => {}) } };
}
describe("Slack test delivery", () => {
  it("posts exactly one short message to the saved channel and never opens a socket", async () => {
    const { client, options } = setup();
    expect(await sendSlackTest(input, options)).toMatchObject({ state: "sent" });
    expect(await sendSlackTest(input, options)).toMatchObject({ state: "sent" });
    expect(client.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ channel: "CCHANNEL", text: expect.stringContaining("DevHub test · work"), blocks: expect.arrayContaining([{ type: "header", text: { type: "plain_text", text: "DevHub test" } }]) }));
    const message = vi.mocked(client.postMessage).mock.calls[0][0];
    expect(message.text).toContain("Replies stay in a thread; changes ask for confirmation");
    expect(message.blocks?.filter((block) => block.type === "actions")).toHaveLength(1);
    expect(client.start).not.toHaveBeenCalled();
  });
  it("binds tests to the saved tokens, recipient and active profile", async () => {
    const { client, options } = setup();
    await expect(sendSlackTest({ ...input, revision: "a".repeat(64) }, options)).rejects.toMatchObject({ kind: "conflict" });
    expect(client.postMessage).not.toHaveBeenCalled();
    await sendSlackTest(input, options);
    await expect(sendSlackTest(input, { ...options, profile: "personal" })).rejects.toMatchObject({ kind: "conflict" });
  });
  it("rejects missing credentials and unrecognised fields without any network call", async () => {
    const { options } = setup();
    await expect(sendSlackTest(input, { ...options, settings: { ...settings, appToken: "" } })).rejects.toMatchObject({ kind: "conflict" });
    const unexpected = { ...input, channel: "COTHER" };
    await expect(sendSlackTest(unexpected, options)).rejects.toThrow();
    expect(options.createClient).not.toHaveBeenCalled();
  });
  it("checks the authenticated workspace before sending", async () => {
    const { client, options } = setup();
    vi.mocked(client.authenticate).mockResolvedValue({ userId: "UBOT", name: "DevHub", teamId: "TOTHER" });
    expect(await sendSlackTest(input, options)).toMatchObject({ state: "failed" });
    expect(client.postMessage).not.toHaveBeenCalled();
  });
  it("records unknown outcomes and never automatically sends them again", async () => {
    const { client, options } = setup();
    vi.mocked(client.postMessage).mockRejectedValue(new Error("private-token"));
    const delivery = await sendSlackTest(input, options);
    expect(delivery).toMatchObject({ state: "unknown" });
    expect(delivery.detail).not.toContain("private-token");
    expect(await sendSlackTest(input, options)).toEqual(delivery);
    expect(client.postMessage).toHaveBeenCalledTimes(1);
  });
  it("keeps authentication failures safe and does not attempt a post", async () => {
    const { client, options } = setup();
    vi.mocked(client.authenticate).mockRejectedValue(Object.assign(new Error("private-token"), { data: { error: "invalid_auth" } }));
    expect(await sendSlackTest(input, options)).toEqual({ state: "failed", detail: "Slack rejected the token. Check the tokens in Setup." });
    expect(client.postMessage).not.toHaveBeenCalled();
  });
});
