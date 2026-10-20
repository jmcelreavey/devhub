import { createHmac, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackGateway, COLLABORATION_TTL, OFFLINE, UNLINKED, type SlackLayer } from "./gateway.ts";
import { Registry } from "./registry.ts";
import { TestDevice } from "./test-device.ts";
import { HANDOFF_DECLINE_ACTION, HANDOFF_PICKUP_ACTION, type GatewayOperation } from "../../shared/slack-gateway/protocol.ts";

let gateway: SlackGateway;
let registry: Registry;
let url: string;
let posted: GatewayOperation[];
let sockets: TestDevice[];
let counter: number;
let slack: SlackLayer;
let now: number;
const keypair = () => {
  const keys = generateKeyPairSync("ed25519");
  return { publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
};
const event = (userId: string, channel = "C1", text = "<@UBOT> hello") => ({ team_id: "T1", event_id: `event-${userId}-${counter++}`, event: { type: "message", user: userId, channel, text, ts: "1.000" } });

beforeEach(async () => {
  now = Date.now(); registry = new Registry(undefined, () => now); posted = []; sockets = []; counter = 0;
  slack = {
    identity: { userId: "UBOT", name: "DevHub", teamId: "T1" },
    member: async (userId) => ({ name: userId, dmChannelId: userId.replace(/^U/, "D") }),
    openGroupDm: vi.fn(async () => "GDM"),
    isChannelMember: vi.fn(async (channel, userId) => ["C1", "G1"].includes(channel) && userId === "U1"),
    execute: async (operation) => { posted.push(operation); if (operation.kind === "postMessage") return { channel: operation.channel, ts: `${counter++}.000` }; },
  };
  gateway = new SlackGateway({ registry, slack, admins: ["U1"], signingSecret: "fake-signing-secret", now: () => now });
  url = `http://127.0.0.1:${await gateway.listen()}`;
});

function thread(userId: string, channel: string, threadTs: string, text = "A suggestion") {
  return { team_id: "T1", event: { type: "message", user: userId, channel, thread_ts: threadTs, ts: "999.000", text } };
}

function handoffOperation(handoffId = "handoff-one"): Extract<GatewayOperation, { kind: "handoff" }> {
  return { kind: "handoff", handoffId, toUserId: "U2", text: "Private handoff note", blocks: [
    { type: "section", text: { type: "mrkdwn", text: "Full private note" } },
    { type: "actions", elements: [
      { type: "button", action_id: HANDOFF_PICKUP_ACTION, text: { type: "plain_text", text: "Pick up" }, value: JSON.stringify({ handoffId, repo: "example/repo", branch: "work" }) },
      { type: "button", action_id: HANDOFF_DECLINE_ACTION, text: { type: "plain_text", text: "Decline" }, value: handoffId },
    ] },
  ] };
}

function click(userId: string, channel: string, ts: string, action = HANDOFF_PICKUP_ACTION) {
  return { type: "block_actions", team: { id: "T1" }, user: { id: userId }, channel: { id: channel },
    container: { type: "message", channel_id: channel, message_ts: ts }, message: { ts }, actions: [{ type: "button", action_id: action, value: "{}" }] };
}

async function disconnect(connection: TestDevice) {
  const closed = once(connection.socket, "close"); connection.socket.close(); await closed;
}

describe("team collaboration boundaries", () => {
  it("keeps a handoff pending while pre-post expiry notifications are still running", async () => {
    const owner = await device("U1"); await device("U2");
    let finishPrune: () => void = () => {};
    const pruning = new Promise<void>((resolve) => { finishPrune = resolve; });
    const prune = vi.spyOn(gateway as unknown as { prune: () => Promise<void> }, "prune").mockImplementationOnce(() => pruning);
    owner.connection.send({ type: "operation", requestId: "pre-post", operation: handoffOperation() });
    await vi.waitFor(() => expect(prune).toHaveBeenCalled());
    expect(registry.handoff("handoff-one")).toBeUndefined();
    expect((await operation(owner.connection, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).handoffs).toEqual([{ handoffId: "handoff-one", status: "pending" }]);
    finishPrune();
    expect(await owner.connection.next("result")).toMatchObject({ requestId: "pre-post", ok: true });
  });
  it("keeps an in-flight Slack post pending for its owner and receiver only", async () => {
    const owner = await device("U1"); const receiver = await device("U2"); const bystander = await device("U3");
    const execute = slack.execute;
    let finishPost: () => void = () => {};
    const posting = new Promise<void>((resolve) => { finishPost = resolve; });
    slack.execute = vi.fn(async (input) => { if (input.kind === "postMessage") await posting; return execute(input); });
    owner.connection.send({ type: "operation", requestId: "slow-post", operation: handoffOperation() });
    await vi.waitFor(() => expect(slack.execute).toHaveBeenCalled());
    expect(registry.handoff("handoff-one")).toBeUndefined();
    for (const connection of [owner.connection, receiver.connection]) {
      expect((await operation(connection, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).handoffs).toEqual([{ handoffId: "handoff-one", status: "pending" }]);
    }
    expect((await operation(bystander.connection, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).ok).toBe(false);
    finishPost();
    expect(await owner.connection.next("result")).toMatchObject({ requestId: "slow-post", ok: true });
  });
  it("rejects a new handoff before posting when retained receipts fill the registry", async () => {
    const owner = await device("U1"); await device("U2");
    vi.spyOn(registry, "canRememberHandoff").mockReturnValue(false);
    const before = posted.length;
    expect(await operation(owner.connection, handoffOperation())).toMatchObject({ ok: false, notSent: true });
    expect(posted).toHaveLength(before);
  });
  it("reconciles missing receipts independently without disclosing another member's handoff", async () => {
    const owner = await device("U1"); const receiver = await device("U2"); const bystander = await device("U3");
    await operation(owner.connection, handoffOperation());
    for (const connection of [owner.connection, receiver.connection]) {
      expect((await operation(connection, { kind: "handoffStatus", handoffIds: ["missing", "handoff-one"] })).handoffs).toEqual([
        { handoffId: "missing", status: "unknown" }, { handoffId: "handoff-one", status: "pending" },
      ]);
    }
    expect((await operation(bystander.connection, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).ok).toBe(false);
    expect((await operation(bystander.connection, { kind: "handoffStatus", handoffIds: ["missing"] })).handoffs).toEqual([{ handoffId: "missing", status: "unknown" }]);
  });
  it("does not let a replacement receiver device resolve or inspect the original receipt", async () => {
    const owner = await device("U1"); await device("U2");
    await operation(owner.connection, handoffOperation());
    const replacement = await device("U2");
    expect((await operation(replacement.connection, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).ok).toBe(false);
    expect((await operation(replacement.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(false);
  });
  it.each([
    [{ code: "slack_webapi_request_error", original: { code: "ECONNREFUSED" } }, true],
    [{ code: "slack_webapi_platform_error", data: { error: "channel_not_found" } }, true],
    [{ code: "slack_webapi_rate_limited_error", retryAfter: 1 }, true],
    [{ code: "slack_webapi_request_error", original: { code: "ECONNRESET" } }, false],
  ])("distinguishes a rejected handoff post from an unknown delivery (%j)", async (failure, notSent) => {
    const owner = await device("U1"); await device("U2");
    slack.execute = vi.fn(async () => { throw failure; });
    const result = await operation(owner.connection, handoffOperation());
    expect(result.ok).toBe(false);
    expect(result.notSent === true).toBe(notSent);
    expect(registry.handoff("handoff-one")).toBeUndefined();
  });
  it("routes top-level group DM replies to the latest active ask and ignores its owner", async () => {
    const owner = await device("U1"); const helper = await device("U2");
    await operation(owner.connection, { kind: "askTeammate", askId: "older", helperUserId: "U2", text: "Older question" });
    const latest = await operation(owner.connection, { kind: "askTeammate", askId: "latest", helperUserId: "U2", text: "Latest question" });
    await gateway.receive(event("U1", "GDM", "My own group reply"), "group-owner");
    await gateway.receive(event("U2", "GDM", "Use the new result"), "group-helper");
    expect((await owner.connection.next("event")).envelope).toMatchObject({ kind: "helper_reply", ask: { askId: "latest", threadTs: latest.receipt!.ts } });
    expect(owner.connection.messages).toEqual([]);
    expect(helper.connection.messages).toEqual([]);
    now += COLLABORATION_TTL + 1;
    await gateway.receive(event("U2", "GDM", "Too late"), "group-expired");
    expect(owner.connection.messages).toEqual([]);
  });

  it("keeps public and private channel asks thread-only", async () => {
    const owner = await device("U1"); await device("U2");
    for (const channel of ["C1", "G1"]) {
      await operation(owner.connection, { kind: "askTeammate", askId: "ask-" + channel, helperUserId: "U2", channel, text: "Question" });
      await gateway.receive(event("U2", channel, "Not in the thread"), "top-" + channel);
    }
    expect(owner.connection.messages).toEqual([]);
  });
  it("lists only other active members in the same team, without device metadata", async () => {
    const owner = await device("U1"); await device("U2"); await device("U3");
    registry.revoke("T1", "U3");
    const other = registry.register(keypair().publicKey, "Other workspace");
    registry.link(other.code, { teamId: "T2", userId: "U4", userName: "four", dmChannelId: "D4" });
    expect((await operation(owner.connection, { kind: "listMembers" })).members).toEqual([{ userId: "U2", userName: "U2" }]);
  });

  it("opens a group DM and relays only the nominated helper to the owner's device", async () => {
    const owner = await device("U1"); const helper = await device("U2"); posted.length = 0;
    const result = await operation(owner.connection, { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", text: "Question" });
    expect(result.ok).toBe(true); expect(slack.openGroupDm).toHaveBeenCalledWith("U1", "U2");
    expect(posted).toEqual([{ kind: "postMessage", channel: "GDM", text: "<@U2> Question" }]);
    expect(registry.receipt("GDM", result.receipt!.ts)).toMatchObject({ kind: "ask", askId: "ask-one", helperUserId: "U2", deviceId: owner.deviceId, userId: "U1", expiresAt: now + COLLABORATION_TTL });
    await gateway.receive(thread("U2", "GDM", result.receipt!.ts), "helper-reply");
    expect((await owner.connection.next("event")).envelope).toMatchObject({ kind: "helper_reply", userId: "U1", helper: { userId: "U2", name: "U2" }, ask: { askId: "ask-one", channel: "GDM", threadTs: result.receipt!.ts } });
    expect(helper.connection.messages).toEqual([]);
    expect(posted).toHaveLength(1);
    expect((await operation(owner.connection, { kind: "postMessage", channel: "GDM", text: "not allowed" }, "helper-reply")).ok).toBe(false);
    expect((await operation(owner.connection, { kind: "postMessage", channel: "D1", text: "Suggested answer" }, "helper-reply")).ok).toBe(true);
    await gateway.receive(thread("U1", "GDM", result.receipt!.ts), "owner-thread");
    expect((await owner.connection.next("event")).envelope.kind).toBe("message");
  });

  it("checks channel membership as the owner and strips device-injected mentions from text and blocks", async () => {
    const owner = await device("U1"); await device("U2"); posted.length = 0;
    const result = await operation(owner.connection, { kind: "askTeammate", askId: "ask-channel", helperUserId: "U2", channel: "C1", text: "<!channel> <!here> <!everyone> <!subteam^S1> <@U3> Question", blocks: [{ type: "section", text: { type: "mrkdwn", text: "<!here> <@U3> Details" } }] });
    expect(result.ok).toBe(true); expect(slack.isChannelMember).toHaveBeenCalledWith("C1", "U1");
    expect(slack.openGroupDm).not.toHaveBeenCalled();
    expect(posted.at(-1)).toMatchObject({ kind: "postMessage", channel: "C1", text: expect.stringMatching(/^<@U2> /) });
    const content = JSON.stringify(posted.at(-1));
    for (const mention of ["<!channel>", "<!here>", "<!everyone>", "<!subteam", "<@U3>"]) expect(content).not.toContain(mention);
    expect((await operation(owner.connection, { kind: "askTeammate", askId: "ask-no", helperUserId: "U2", channel: "C2", text: "No" })).ok).toBe(false);
    expect((await operation(owner.connection, { kind: "askTeammate", askId: "ask-channel", helperUserId: "U2", text: "Replay" })).ok).toBe(false);
    expect(posted).toHaveLength(1);
  });

  it("removes rich-text user, user-group and broadcast mentions as well as mrkdwn mentions", async () => {
    const owner = await device("U1"); await device("U2"); posted.length = 0;
    await operation(owner.connection, { kind: "askTeammate", askId: "rich-ask", helperUserId: "U2", text: "Question", blocks: [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [
      { type: "user", user_id: "U3" }, { type: "usergroup", usergroup_id: "S1" }, { type: "broadcast", range: "here" }, { type: "text", text: "Question" },
    ] }] }] });
    expect(JSON.stringify(posted.at(-1))).not.toMatch(/user_id|usergroup_id|broadcast/);
    expect(JSON.stringify(posted.at(-1))).toContain("<@U2>");
  });

  it("keeps bystanders off devices and rate-limits fixed bot-thread ephemerals, without spamming ordinary threads", async () => {
    const owner = await device("U1"); const helper = await device("U2"); const bystander = await device("U3");
    const result = await operation(owner.connection, { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", channel: "C1", text: "Question" }); posted.length = 0;
    await gateway.receive(thread("U3", "C1", result.receipt!.ts), "bystander-one");
    await gateway.receive(thread("U3", "C1", result.receipt!.ts), "bystander-two");
    await gateway.receive(thread("U3", "C1", "123.456"), "ordinary-thread");
    expect(posted).toEqual([{ kind: "ephemeral", channel: "C1", threadTs: result.receipt!.ts, userId: "U3", text: "This is <@U1>'s task. Ask them to add you." }]);
    expect(owner.connection.messages).toEqual([]); expect(helper.connection.messages).toEqual([]); expect(bystander.connection.messages).toEqual([]);
    now += 10 * 60_000;
    await gateway.receive(thread("U3", "C1", result.receipt!.ts), "bystander-after-limit");
    expect(posted).toHaveLength(2);
    expect((await operation(owner.connection, { kind: "ephemeral", channel: "C1", userId: "U3", text: "Forged" })).ok).toBe(false);
  });

  it("uses a fixed ephemeral when the owner is offline, without queueing the helper reply", async () => {
    const owner = await device("U1"); const helper = await device("U2");
    const result = await operation(owner.connection, { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", text: "Question" });
    await disconnect(owner.connection); posted.length = 0;
    await gateway.receive(thread("U2", "GDM", result.receipt!.ts), "offline-helper");
    expect(posted).toEqual([{ kind: "ephemeral", channel: "GDM", threadTs: result.receipt!.ts, userId: "U2", text: "<@U1>'s DevHub is offline; they'll see your reply in Slack." }]);
    expect(helper.connection.messages).toEqual([]);
    const reconnected = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(reconnected);
    await reconnected.authenticate(owner.deviceId, owner.privateKey); await reconnected.next("linked");
    expect(reconnected.messages).toEqual([]);
  });

  it("expires asks at 24 hours and never relays bot, hidden or wrong-workspace helper payloads", async () => {
    const owner = await device("U1"); await device("U2");
    const result = await operation(owner.connection, { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", text: "Question" }); posted.length = 0;
    const reply = thread("U2", "GDM", result.receipt!.ts);
    for (const change of [{ bot_id: "B1" }, { hidden: true }, { subtype: "message_changed" }]) await gateway.receive({ ...reply, event: { ...reply.event, ...change } });
    await gateway.receive({ ...reply, team_id: "T2" });
    expect(posted).toEqual([]); expect(owner.connection.messages).toEqual([]);
    now += COLLABORATION_TTL;
    await gateway.receive(reply);
    expect(posted.at(-1)).toMatchObject({ kind: "ephemeral", text: "This is <@U1>'s task. Ask them to add you." });
    expect(owner.connection.messages).toEqual([]);
  });

  it.each([
    { kind: "askTeammate", askId: "ask-one", helperUserId: "U1", text: "self" },
    { kind: "askTeammate", askId: "ask-one", helperUserId: "UBOT", text: "bot" },
    { kind: "askTeammate", askId: "ask-one", helperUserId: "C1", text: "not a user" },
    { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", userId: "U3", text: "forged identity" },
    { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", channel: "D2", text: "other DM" },
    { kind: "handoff", handoffId: "handoff-one", toUserId: "U3", text: "unlinked", blocks: [] },
  ])("rejects spoofed or invalid collaboration operations: %j", async (value) => {
    const owner = await device("U1"); await device("U2"); posted.length = 0;
    expect((await operation(owner.connection, value as GatewayOperation)).ok).toBe(false); expect(posted).toEqual([]);
  });

  it("rejects a helper clicking the owner's suggested-answer card", async () => {
    const owner = await device("U1"); const helper = await device("U2");
    const suggestion = await operation(owner.connection, { kind: "postMessage", channel: "D1", text: "Suggested answer from helper" }); posted.length = 0;
    await gateway.receive(click("U2", "D1", suggestion.receipt!.ts, "devhub_confirm_answer"));
    expect(posted.at(-1)).toMatchObject({ channel: "D2", text: expect.stringContaining("another session or member") });
    expect(owner.connection.messages).toEqual([]); expect(helper.connection.messages).toEqual([]);
  });

  it("delivers handoff clicks only to the receiver and accepts a pickup once", async () => {
    const owner = await device("U1"); const helper = await device("U2"); const bystander = await device("U3"); posted.length = 0;
    const result = await operation(owner.connection, handoffOperation());
    expect(result.receipt?.channel).toBe("D2");
    const receipt = registry.handoff("handoff-one")!;
    expect(receipt).toMatchObject({ deviceId: owner.deviceId, toDeviceId: helper.deviceId, userId: "U1", toUserId: "U2", expiresAt: now + COLLABORATION_TTL, status: "pending" });
    expect(JSON.stringify(receipt)).not.toMatch(/Private|repo|branch|blocks/);
    for (const userId of ["U1", "U3"]) for (const action of [HANDOFF_PICKUP_ACTION, HANDOFF_DECLINE_ACTION]) await gateway.receive(click(userId, "D2", result.receipt!.ts, action));
    expect(owner.connection.messages).toEqual([]); expect(helper.connection.messages).toEqual([]); expect(bystander.connection.messages).toEqual([]);
    expect((await operation(owner.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(false);
    expect((await operation(bystander.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(false);
    await gateway.receive(click("U2", "D2", result.receipt!.ts), "pickup");
    expect((await helper.connection.next("event")).envelope).toMatchObject({ kind: "block_actions", userId: "U2", handoff: { handoffId: "handoff-one", fromUserId: "U1", fromName: "U1" } });
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" }, "pickup")).ok).toBe(true);
    expect((await owner.connection.next("event")).envelope).toMatchObject({ kind: "handoff_result", handoffId: "handoff-one", status: "accepted", byUserId: "U2" });
    expect(posted.at(-1)).toMatchObject({ kind: "update", channel: "D2", ts: result.receipt!.ts, text: "Picked up", blocks: [] });
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" }, "pickup")).ok).toBe(true);
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(true);
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "failed" })).ok).toBe(false);
    expect((await operation(owner.connection, { kind: "update", channel: "D2", ts: result.receipt!.ts, text: "Take it back" })).ok).toBe(false);
    await gateway.receive(click("U2", "D2", result.receipt!.ts), "used-pickup"); expect(helper.connection.messages).toEqual([]);
    expect((await operation(helper.connection, { kind: "postMessage", channel: "D2", text: "Receiver's next Needs-you" })).ok).toBe(true);
    expect((await operation(owner.connection, { kind: "postMessage", channel: "D2", text: "Owner cannot post as receiver" })).ok).toBe(false);
    expect((await operation(owner.connection, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).handoffs).toEqual([{ handoffId: "handoff-one", status: "accepted", byUserId: "U2" }]);
    expect((await operation(helper.connection, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).handoffs).toEqual([{ handoffId: "handoff-one", status: "accepted", byUserId: "U2" }]);
  });

  it("allows private completion notices without restoring terminal handoff authority", async () => {
    const owner = await device("U1"); const helper = await device("U2");
    const result = await operation(owner.connection, handoffOperation());
    await gateway.receive(click("U2", "D2", result.receipt!.ts), "pickup-notice");
    await helper.connection.next("event");
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" }, "pickup-notice")).ok).toBe(true);
    const terminal = (await owner.connection.next("event")).envelope;
    expect((await operation(owner.connection, { kind: "postMessage", channel: "D1", text: "Handed to @helper" }, terminal.id)).ok).toBe(true);
    expect((await operation(helper.connection, { kind: "postMessage", channel: "D2", text: "Picked up, but Jira could not be reassigned." }, "pickup-notice")).ok).toBe(true);
    expect((await operation(helper.connection, { kind: "postMessage", channel: "D2", threadTs: result.receipt!.ts, text: "Reuse card" }, "pickup-notice")).ok).toBe(false);
    expect((await operation(helper.connection, { kind: "update", channel: "D2", ts: result.receipt!.ts, text: "Reuse card" }, "pickup-notice")).ok).toBe(false);
    expect((await operation(helper.connection, { kind: "listMembers" }, "pickup-notice")).ok).toBe(false);
    expect((await operation(helper.connection, { kind: "postMessage", channel: "D2", text: "Wrong result scope" }, terminal.id)).ok).toBe(false);
    expect((await operation(owner.connection, { kind: "postMessage", channel: "D2", text: "Wrong destination" }, terminal.id)).ok).toBe(false);
  });

  it("uses plain offline-owner copy when a handoff is accepted", async () => {
    const owner = await device("U1"); const helper = await device("U2");
    const result = await operation(owner.connection, handoffOperation());
    await disconnect(owner.connection);
    await gateway.receive(click("U2", "D2", result.receipt!.ts), "offline-pickup");
    await helper.connection.next("event");
    await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" }, "offline-pickup");
    expect(posted).toContainEqual(expect.objectContaining({ kind: "postMessage", channel: "D1", text: "<@U2> picked up your handoff." }));
  });

  it.each([false, true])("declines once and notifies the owner (offline=%s)", async (offline) => {
    const owner = await device("U1"); const helper = await device("U2");
    const result = await operation(owner.connection, handoffOperation());
    if (offline) await disconnect(owner.connection);
    posted.length = 0;
    await gateway.receive(click("U2", "D2", result.receipt!.ts, HANDOFF_DECLINE_ACTION), "decline");
    expect((await helper.connection.next("event")).envelope.handoff?.handoffId).toBe("handoff-one");
    expect(registry.handoff("handoff-one")?.status).toBe("declined");
    if (offline) expect(posted).toContainEqual(expect.objectContaining({ kind: "postMessage", channel: "D1", text: "<@U2> declined your handoff. It's yours again." }));
    else expect((await owner.connection.next("event")).envelope.status).toBe("declined");
    const count = posted.filter((entry) => entry.kind === "update").length;
    await gateway.receive(click("U2", "D2", result.receipt!.ts, HANDOFF_DECLINE_ACTION));
    expect(posted.filter((entry) => entry.kind === "update")).toHaveLength(count);
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(false);
  });

  it.each([false, true])("expires at 24 hours, removes card actions and notifies once (offline=%s)", async (offline) => {
    const owner = await device("U1"); const helper = await device("U2");
    const result = await operation(owner.connection, handoffOperation());
    if (offline) await disconnect(owner.connection);
    posted.length = 0; now += COLLABORATION_TTL;
    await Promise.all([gateway["prune"](), gateway["prune"]()]);
    expect(registry.handoff("handoff-one")?.status).toBe("expired");
    expect(posted.filter((entry) => entry.kind === "update")).toEqual([{ kind: "update", channel: "D2", ts: result.receipt!.ts, text: "Expired", blocks: [] }]);
    if (offline) expect(posted).toContainEqual(expect.objectContaining({ channel: "D1", text: "Your handoff to <@U2> expired. It's yours again." }));
    else expect((await owner.connection.next("event")).envelope.status).toBe("expired");
    await gateway.receive(click("U2", "D2", result.receipt!.ts)); expect(helper.connection.messages).toEqual([]);
  });

  it("keeps a pickup pending when the receiver cannot clone yet, and allows retry before expiry", async () => {
    const owner = await device("U1"); const helper = await device("U2");
    const result = await operation(owner.connection, handoffOperation());
    await gateway.receive(click("U2", "D2", result.receipt!.ts), "first-pickup"); await helper.connection.next("event");
    expect((await operation(helper.connection, { kind: "postMessage", channel: "D2", text: "Clone example/repo first, then click Pick up again" }, "first-pickup")).ok).toBe(true);
    expect(registry.handoff("handoff-one")?.status).toBe("pending");
    await gateway.receive(click("U2", "D2", result.receipt!.ts), "retry-pickup");
    expect((await helper.connection.next("event")).envelope.id).toBe("retry-pickup");
  });

  it("reconciles an offline decline on the owner's reconnect without queueing the result", async () => {
    const owner = await device("U1"); await device("U2");
    const result = await operation(owner.connection, handoffOperation()); await disconnect(owner.connection);
    await gateway.receive(click("U2", "D2", result.receipt!.ts, HANDOFF_DECLINE_ACTION));
    const reconnected = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(reconnected);
    await reconnected.authenticate(owner.deviceId, owner.privateKey); await reconnected.next("linked");
    expect(reconnected.messages).toEqual([]);
    expect((await operation(reconnected, { kind: "handoffStatus", handoffIds: ["handoff-one"] })).handoffs).toEqual([{ handoffId: "handoff-one", status: "declined", byUserId: "U2" }]);
    expect((await operation(reconnected, { kind: "handoffStatus", handoffIds: ["unknown"] })).handoffs).toEqual([{ handoffId: "unknown", status: "unknown" }]);
  });

  it("keeps the terminal result durable if Slack cannot update the receiver card", async () => {
    const owner = await device("U1"); const helper = await device("U2"); await operation(owner.connection, handoffOperation());
    const execute = slack.execute;
    slack.execute = async (value) => { if (value.kind === "update") throw new Error("Slack update failed"); return execute(value); };
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(true);
    expect((await owner.connection.next("event")).envelope.status).toBe("accepted");
    expect(registry.handoff("handoff-one")?.status).toBe("accepted");
  });

  it("prevents duplicate cards from concurrent handoffs with the same ID", async () => {
    const owner = await device("U1"); await device("U2"); posted.length = 0;
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; }); const execute = slack.execute;
    slack.execute = async (value) => { await waiting; return execute(value); };
    owner.connection.send({ type: "operation", requestId: "first", operation: handoffOperation() });
    owner.connection.send({ type: "operation", requestId: "second", operation: handoffOperation() });
    expect(await owner.connection.next("result")).toMatchObject({ requestId: "second", ok: false });
    release!(); expect(await owner.connection.next("result")).toMatchObject({ requestId: "first", ok: true });
    expect(posted).toHaveLength(1);
  });

  it("treats an explicit failed pickup as expired and returns control to the owner", async () => {
    const owner = await device("U1"); const helper = await device("U2"); await operation(owner.connection, handoffOperation());
    expect((await operation(helper.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "failed" })).ok).toBe(true);
    expect((await owner.connection.next("event")).envelope.status).toBe("expired");
    expect(registry.handoff("handoff-one")?.status).toBe("expired");
  });

  it.each(["U1", "U2"])("expires pending handoffs when %s unlinks", async (userId) => {
    const owner = await device("U1"); const helper = await device("U2"); await operation(owner.connection, handoffOperation()); posted.length = 0;
    await gateway.command("T1", userId, "unlink");
    expect(registry.handoff("handoff-one")?.status).toBe("expired");
    if (userId === "U2") expect((await owner.connection.next("event")).envelope.status).toBe("expired");
    else expect(posted).toContainEqual(expect.objectContaining({ channel: "D1", text: expect.stringContaining("expired") }));
    expect((await operation(userId === "U1" ? helper.connection : owner.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(false);
  });

  it("expires handoffs when the receiver re-links instead of transferring them to a new device", async () => {
    const owner = await device("U1"); await device("U2"); await operation(owner.connection, handoffOperation());
    const replacement = await device("U2");
    expect((await owner.connection.next("event")).envelope.status).toBe("expired");
    expect((await operation(replacement.connection, { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" })).ok).toBe(false);
  });

  it("does not deliver new kinds to old devices without capabilities", async () => {
    const owner = await device("U1"); await device("U2");
    const result = await operation(owner.connection, { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", text: "Question" });
    await disconnect(owner.connection);
    const legacy = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(legacy);
    await legacy.authenticate(owner.deviceId, owner.privateKey, []); await legacy.next("linked"); posted.length = 0;
    await gateway.receive(thread("U2", "GDM", result.receipt!.ts));
    expect(posted.at(-1)).toMatchObject({ kind: "ephemeral", text: expect.stringContaining("offline") });
    expect(legacy.messages).toEqual([]);
    expect((await operation(legacy, { kind: "listMembers" })).ok).toBe(false);
  });

  it("rejects oversized pickup bundles and duplicate handoff IDs without posting", async () => {
    const owner = await device("U1"); await device("U2"); posted.length = 0;
    const oversized = handoffOperation(); oversized.blocks = [{ type: "actions", elements: [{ type: "button", action_id: HANDOFF_PICKUP_ACTION, value: "x".repeat(1901) }, { type: "button", action_id: HANDOFF_DECLINE_ACTION }] }];
    expect((await operation(owner.connection, oversized)).ok).toBe(false); expect(posted).toEqual([]);
    expect((await operation(owner.connection, handoffOperation())).ok).toBe(true);
    expect((await operation(owner.connection, handoffOperation())).ok).toBe(false);
    expect(posted).toHaveLength(1);
  });
});
afterEach(async () => { for (const device of sockets) device.socket.terminate(); await gateway.close(); });

async function device(userId: string) {
  const keys = keypair();
  const response = await fetch(`${url}/register`, { method: "POST", body: JSON.stringify({ publicKey: keys.publicKey, label: "Laptop" }) });
  expect(response.status).toBe(201);
  const pairing = await response.json() as { code: string; deviceId: string };
  const connection = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(connection);
  await connection.authenticate(pairing.deviceId, keys.privateKey); await connection.next("awaiting_link");
  await gateway.command("T1", userId, `link ${pairing.code}`); await connection.next("linked");
  return { ...pairing, ...keys, connection };
}

async function operation(connection: TestDevice, value: GatewayOperation, eventId?: string, requestId = `request-${counter++}`) {
  connection.send({ type: "operation", requestId, operation: value, eventId });
  return connection.next("result");
}

describe("gateway routing boundaries", () => {
  it("flushes deferred registry writes on shutdown", async () => {
    const flush = vi.spyOn(registry, "flush");
    await gateway.close();
    expect(flush).toHaveBeenCalledOnce();
  });
  it("skips channel chatter but accepts DMs, mentions and member-owned bot-thread replies", async () => {
    const one = await device("U1"); posted.length = 0;
    await gateway.receive(event("U1", "C1", "my tickets"), "chatter");
    await gateway.receive(event("U3", "C1", "my tickets"), "unlinked-chatter");
    expect(posted).toEqual([]); expect(gateway["scopes"].has("chatter")).toBe(false);
    await gateway.receive(event("U1", "D1", "my tickets"), "dm"); expect((await one.connection.next("event")).envelope.id).toBe("dm");
    await gateway.receive(event("U1"), "mention"); await one.connection.next("event");
    await operation(one.connection, { kind: "postMessage", channel: "C1", text: "reply" }, "mention");
    const reply = { ...event("U1", "C1", "a thread reply"), event: { ...event("U1", "C1", "a thread reply").event, thread_ts: "1.000" } };
    await gateway.receive(reply, "thread"); expect((await one.connection.next("event")).envelope.id).toBe("thread");
    await gateway.receive({ ...reply, event: { ...reply.event, user: "U2" } }, "wrong-member-thread");
    expect(gateway["scopes"].has("wrong-member-thread")).toBe(false);
  });
  it("forces event-scoped shared-channel posts into the event thread and keeps DMs optional", async () => {
    const one = await device("U1");
    await gateway.receive(event("U1"), "root"); await one.connection.next("event");
    expect((await operation(one.connection, { kind: "postMessage", channel: "C1", text: "root reply" }, "root")).ok).toBe(true);
    expect(posted.at(-1)).toMatchObject({ threadTs: "1.000" });
    await gateway.receive({ ...event("U1"), event: { ...event("U1").event, ts: "2.000", thread_ts: "1.000" } }, "threaded"); await one.connection.next("event");
    await operation(one.connection, { kind: "postMessage", channel: "C1", text: "thread reply" }, "threaded");
    expect(posted.at(-1)).toMatchObject({ threadTs: "1.000" });
    await operation(one.connection, { kind: "postMessage", channel: "D1", text: "private" });
    expect(posted.at(-1)).not.toHaveProperty("threadTs");
  });
  it("evicts the oldest seen event under flood instead of dropping every new event", async () => {
    const one = await device("U1");
    for (let index = 0; index < 10_001; index++) await gateway.receive(event("U1", "C1", "ordinary chatter"), `flood-${index}`);
    expect(gateway["seen"].size).toBe(10_000); expect(gateway["seen"].has("flood-0")).toBe(false);
    await gateway.receive(event("U1", "D1", "prs"), "new-event");
    expect((await one.connection.next("event")).envelope.id).toBe("new-event");
    expect(gateway["seen"].has("new-event")).toBe(true);
  });
  it("health is public but registration validates keys and origins", async () => {
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    expect((await fetch(`${url}/register`, { method: "POST", body: JSON.stringify({ publicKey: "bad", label: "Laptop" }) })).status).toBe(400);
    expect((await fetch(`${url}/register`, { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" })).status).toBe(429);
  });
  it("verifies the raw Events API signature and timestamp before acknowledgement", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "fake-challenge" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "fake-signing-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    const headers = { "Content-Type": "application/json", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature };
    expect(await (await fetch(`${url}/slack/events`, { method: "POST", headers, body })).json()).toEqual({ challenge: "fake-challenge" });
    expect((await fetch(`${url}/slack/events`, { method: "POST", headers, body: body + " " })).status).toBe(401);
    expect((await fetch(`${url}/slack/events`, { method: "POST", headers: { ...headers, "x-slack-request-timestamp": "1" }, body })).status).toBe(401);
    expect(posted).toEqual([]);
  });
  it("rejects bad signatures before a device can receive an event", async () => {
    const keys = keypair(); const pending = registry.register(keys.publicKey, "Laptop");
    const connection = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(connection);
    await connection.next("challenge");
    const closed = once(connection.socket, "close");
    connection.send({ type: "auth", deviceId: pending.deviceId, timestamp: Date.now(), signature: "bad" });
    expect((await closed)[0]).toBe(1008);
    expect(connection.messages.some((message) => message.type === "linked")).toBe(false);
  });
  it("cancels an authenticated pending registration without granting delivery access", async () => {
    const keys = keypair(); const pending = registry.register(keys.publicKey, "Laptop");
    const connection = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(connection);
    await connection.authenticate(pending.deviceId, keys.privateKey); await connection.next("awaiting_link");
    expect((await operation(connection, { kind: "postMessage", channel: "D1", text: "forbidden" })).ok).toBe(false);
    connection.send({ type: "unlink" }); await connection.next("revoked"); expect(registry.key(pending.deviceId)).toBeUndefined();
  });
  it("returns only safe retry metadata and treats uncertain sends as uncertain", async () => {
    const one = await device("U1");
    const send = vi.spyOn(slack, "execute");
    send.mockRejectedValueOnce(Object.assign(new Error("private-token-and-message"), { code: "slack_webapi_rate_limited_error", retryAfter: 5 }));
    const limited = await operation(one.connection, { kind: "postMessage", channel: "D1", text: "private-content" });
    expect(limited).toMatchObject({ ok: false, retryAfter: 5 }); expect(JSON.stringify(limited)).not.toContain("private");
    send.mockRejectedValueOnce(new Error("private-request-error"));
    const uncertain = await operation(one.connection, { kind: "postMessage", channel: "D1", text: "private-content" });
    expect(uncertain).toMatchObject({ ok: false }); expect(uncertain.notSent).toBeUndefined(); expect(uncertain.retryAfter).toBeUndefined();
  });
  it("pairs two members, isolates messages and refuses another member's DM and Home", async () => {
    const one = await device("U1"); const two = await device("U2");
    await gateway.receive(event("U1"), "one");
    expect((await one.connection.next("event")).envelope.userId).toBe("U1");
    await gateway.receive(event("U2"), "two");
    expect((await two.connection.next("event")).envelope.userId).toBe("U2");
    expect(one.connection.messages.filter((item) => item.type === "event")).toEqual([]);
    expect(two.connection.messages.filter((item) => item.type === "event")).toEqual([]);
    expect((await operation(one.connection, { kind: "postMessage", channel: "D2", text: "no" }, "one")).ok).toBe(false);
    expect((await operation(one.connection, { kind: "viewsPublish", userId: "U2", view: { type: "home", blocks: [] } }, "one")).ok).toBe(false);
    expect((await operation(one.connection, { kind: "ephemeral", channel: "C1", userId: "U2", text: "no" }, "one")).ok).toBe(false);
    expect((await operation(one.connection, { kind: "postMessage", channel: "C2", text: "no" }, "one")).ok).toBe(false);
    expect((await operation(one.connection, { kind: "postMessage", channel: "C1", text: "no" }, "two")).ok).toBe(false);
    expect((await operation(one.connection, { kind: "postMessage", channel: "C1", threadTs: "99.0", text: "no" }, "one")).ok).toBe(false);
    expect((await operation(one.connection, { kind: "postMessage", channel: "C1", text: "yes" }, "one")).ok).toBe(true);
    expect((await operation(one.connection, { kind: "postMessage", channel: "D1", text: "proactive" })).ok).toBe(true);
  });
  it("binds shared-channel cards to their member and rejects operation replay", async () => {
    const one = await device("U1"); await device("U2");
    await gateway.receive(event("U1"), "one"); await one.connection.next("event");
    const result = await operation(one.connection, { kind: "postMessage", channel: "C1", text: "Confirm" }, "one", "single-use");
    expect(result.ok).toBe(true);
    expect((await operation(one.connection, { kind: "postMessage", channel: "C1", text: "Confirm" }, "one", "single-use")).ok).toBe(false);
    await gateway.receive({ type: "block_actions", team: { id: "T1" }, user: { id: "U2" }, channel: { id: "C1" }, container: { type: "message", message_ts: result.receipt!.ts } }, "wrong-click");
    expect(posted.at(-1)).toMatchObject({ channel: "D2", text: expect.stringContaining("another session or member") });
    expect((await operation(one.connection, { kind: "update", channel: "C1", ts: "99.0", text: "no" }, "one")).ok).toBe(false);
    expect((await operation(one.connection, { kind: "update", channel: "C1", ts: result.receipt!.ts, text: "yes" }, "one")).ok).toBe(true);
  });
  it("refreshes exhausted replay protection instead of permanently rejecting a live device", async () => {
    const one = await device("U1");
    const session = gateway["sessions"].get(one.deviceId)!;
    for (let index = 0; index < 10_000; index++) session.requests.add(`previous-${index}`);
    const closed = once(one.connection.socket, "close");
    expect((await operation(one.connection, { kind: "postMessage", channel: "D1", text: "refresh" })).notSent).toBe(true);
    expect((await closed)[0]).toBe(1000);
    const reconnect = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(reconnect);
    await reconnect.authenticate(one.deviceId, one.privateKey); await reconnect.next("linked");
    expect((await operation(reconnect, { kind: "postMessage", channel: "D1", text: "new session" })).ok).toBe(true);
  });
  it("does not queue offline events, and unlink revokes the live socket", async () => {
    const two = await device("U2");
    const closed = once(two.connection.socket, "close"); two.connection.socket.close(); await closed;
    await gateway.receive(event("U2"), "offline");
    expect(posted.at(-1)).toMatchObject({ channel: "D2", text: OFFLINE });
    const reconnect = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(reconnect);
    await reconnect.authenticate(two.deviceId, two.privateKey); await reconnect.next("linked");
    expect(reconnect.messages.filter((message) => message.type === "event")).toEqual([]);
    await gateway.command("T1", "U2", "unlink"); expect((await reconnect.next("revoked")).type).toBe("revoked");
    expect(registry.member("T1", "U2")).toBeUndefined();
    await gateway.receive(event("U2"), "unlinked"); expect(posted.at(-1)).toMatchObject({ text: UNLINKED });
  });
  it("replaces one live socket and throttles messages per member", async () => {
    const one = await device("U1");
    const oldClosed = once(one.connection.socket, "close");
    const next = new TestDevice(`${url.replace("http:", "ws:")}/device`); sockets.push(next);
    await next.authenticate(one.deviceId, one.privateKey); await next.next("linked"); await oldClosed;
    for (let index = 0; index < 25; index++) await gateway.receive(event("U1"), `burst-${index}`);
    await vi.waitFor(() => expect(next.messages.filter((message) => message.type === "event")).toHaveLength(19));
  });
  it("limits registration per IP and five bad link attempts per member", async () => {
    for (let index = 0; index < 60; index++) await fetch(`${url}/register`, { method: "POST", body: "{}" });
    expect((await fetch(`${url}/register`, { method: "POST", body: "{}" })).status).toBe(429);
    for (let index = 0; index < 6; index++) await gateway.command("T1", "U1", "link BADCODEZ");
    expect(posted.at(-1)).toMatchObject({ text: expect.stringContaining("Too many link attempts") });
  });
  it("only administrators get device metadata, never keys", async () => {
    await device("U1");
    await gateway.command("T1", "U2", "devices"); expect(posted.at(-1)).toMatchObject({ text: expect.stringContaining("Use /devhub") });
    await gateway.command("T1", "U1", "devices");
    expect(JSON.stringify(posted.at(-1))).toContain("Laptop"); expect(JSON.stringify(posted.at(-1))).not.toContain("PUBLIC KEY");
  });
});
