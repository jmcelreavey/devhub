import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGatewayClient, gatewayReconnectDelay, type GatewayClient } from "./gateway-client";
import { confirmGatewayBinding, readGatewayDevice, registerGatewayDevice } from "./gateway-state";
import { HANDOFF_PICKUP_ACTION } from "@shared/slack-gateway/protocol";

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: Record<string, unknown>[] = [];
  results: Array<Record<string, unknown>> = [];
  send(text: string) {
    const message = JSON.parse(text) as Record<string, unknown>;
    this.sent.push(message);
    if (message.type === "operation") queueMicrotask(() => this.incoming({ type: "result", requestId: message.requestId, ...(this.results.shift() ?? { ok: true, receipt: { channel: "D1", ts: "2.000" } }) }));
  }
  incoming(value: unknown) { this.emit("message", Buffer.from(JSON.stringify(value))); }
  close(code = 1000) { this.readyState = WebSocket.CLOSED; this.emit("close", code); }
  terminate() { this.close(); }
  ping() {}
}

let root: string;
let client: GatewayClient | undefined;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-client-unit-")); });
afterEach(async () => { await client?.stop(); fs.rmSync(root, { recursive: true, force: true }); });

async function setup() {
  await registerGatewayDevice("https://gateway.test", root, vi.fn(async () => new Response(JSON.stringify({ deviceId: randomUUID(), code: "ABCD2345", expiresAt: Date.now() + 600_000 }), { status: 201 })));
  const device = readGatewayDevice(root)!;
  const socket = new FakeSocket();
  const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {});
  client = createGatewayClient({ mode: "gateway", gatewayUrl: "https://gateway.test", botToken: "", appToken: "", channelId: "", teamId: "", allowedUserId: "" }, { root, socket: () => socket as unknown as WebSocket, retry: { sleep } });
  const receive = vi.fn(async () => {}); client.onEnvelope(receive);
  const authenticating = client.authenticate();
  const binding = { deviceId: device.deviceId, teamId: "T1", userId: "U1", userName: "one", dmChannelId: "D1" };
  socket.incoming({ type: "linked", binding, identity: { teamId: "T1", userId: "UBOT", name: "DevHub" } });
  await vi.waitFor(() => expect(readGatewayDevice(root)?.binding).toBeDefined());
  const approve = async () => { confirmGatewayBinding(device.deviceId, "U1", root); await client!.authenticate(); await authenticating; };
  return { socket, device, sleep, receive, approve, binding, authenticating };
}

it("ignores all envelopes while pairing is pending, then accepts them after local confirmation", async () => {
  const test = await setup();
  const envelope = { id: "e1", kind: "message", teamId: "T1", userId: "U1", channelId: "D1", payload: {}, deadline: Date.now() + 120_000 };
  test.socket.incoming({ type: "event", envelope }); await Promise.resolve();
  expect(test.receive).not.toHaveBeenCalled();
  await expect(client!.postMessage({ channel: "D1", text: "blocked" })).rejects.toThrow("offline");
  expect(test.socket.sent).toHaveLength(0);
  await test.approve();
  test.socket.incoming({ type: "event", envelope });
  await vi.waitFor(() => expect(test.receive).toHaveBeenCalledOnce());
});

it("rejects an owner change even after approval; a new device must be linked", async () => {
  const test = await setup(); await test.approve();
  test.socket.incoming({ type: "linked", binding: { ...test.binding, userId: "U2" }, identity: { teamId: "T1", userId: "UBOT", name: "DevHub" } });
  await vi.waitFor(() => expect(test.socket.readyState).toBe(WebSocket.CLOSED));
  expect(readGatewayDevice(root)?.binding?.userId).toBe("U1");
  await expect(client!.postMessage({ channel: "D1", text: "blocked" })).rejects.toThrow("offline");
});

it("retries only explicit gateway 429 results, honours retryAfter and uses fresh request IDs", async () => {
  const test = await setup(); await test.approve();
  test.socket.results.push({ ok: false, retryAfter: 3 }, { ok: false, retryAfter: 5 });
  expect(await client!.postMessage({ channel: "D1", text: "once" })).toEqual({ channel: "D1", ts: "2.000" });
  expect(test.sleep.mock.calls).toEqual([[3000], [5000]]);
  expect(new Set(test.socket.sent.map((entry) => entry.requestId)).size).toBe(3);
});

it.each([{ ok: false }, { ok: false, notSent: true }, { ok: false, retryAfter: 61 }])("does not retry an uncertain, refused or excessive-wait result: %j", async (result) => {
  const test = await setup(); await test.approve(); test.socket.results.push(result);
  await expect(client!.postMessage({ channel: "D1", text: "once" })).rejects.toThrow();
  expect(test.socket.sent).toHaveLength(1); expect(test.sleep).not.toHaveBeenCalled();
});

it("bounds explicit 429 retries at four attempts", async () => {
  const test = await setup(); await test.approve();
  test.socket.results.push(...Array.from({ length: 4 }, () => ({ ok: false, retryAfter: 1 })));
  await expect(client!.updateMessage({ channel: "D1", ts: "1.000", text: "progress" })).rejects.toThrow("slow down");
  expect(test.socket.sent).toHaveLength(4); expect(test.sleep).toHaveBeenCalledTimes(3);
});

it("jitters reconnects above and below the base delay", () => {
  expect(gatewayReconnectDelay(5000, () => 0)).toBe(3750);
  expect(gatewayReconnectDelay(5000, () => 1)).toBe(6250);
});

function helperEnvelope() {
  return { id: "helper-one", kind: "helper_reply", teamId: "T1", userId: "U1", channelId: "G1", threadTs: "1.000", deadline: Date.now() + 120_000,
    helper: { userId: "U2", name: "Helper" }, ask: { askId: "ask-one", channel: "G1", threadTs: "1.000" },
    payload: { team_id: "T1", event_id: "slack-one", event: { type: "message", user: "U2", channel: "G1", thread_ts: "1.000", ts: "2.000", text: "Suggestion" } } };
}

function handoffResultEnvelope() {
  const result = { handoffId: "handoff-one", status: "accepted", byUserId: "U2" };
  return { id: "result-one", kind: "handoff_result", teamId: "T1", userId: "U1", deadline: Date.now() + 120_000, ...result, payload: result };
}

function handoffClickEnvelope() {
  return { id: "pickup-one", kind: "block_actions", teamId: "T1", userId: "U1", channelId: "D1", threadTs: "1.000", deadline: Date.now() + 120_000,
    handoff: { handoffId: "handoff-one", fromUserId: "U2", fromName: "Helper" },
    payload: { type: "block_actions", team: { id: "T1" }, user: { id: "U1" }, channel: { id: "D1" }, container: { message_ts: "1.000" }, actions: [{ type: "button", action_id: HANDOFF_PICKUP_ACTION, value: "{}" }] } };
}

it("announces collaboration capabilities on authentication", async () => {
  const test = await setup();
  test.socket.incoming({ type: "challenge", nonce: "a".repeat(64) });
  expect(test.socket.sent[0]).toMatchObject({ type: "auth", capabilities: ["ask", "handoff"], deviceId: test.device.deviceId });
  await test.approve();
});

it("exposes typed helpers for members, asks, handoffs, resolution and status reconciliation", async () => {
  const test = await setup(); await test.approve();
  const members = [{ userId: "U2", userName: "Helper" }]; test.socket.results.push({ ok: true, members });
  expect(await client!.listMembers()).toEqual(members);
  expect(await client!.askTeammate({ askId: "ask-one", helperUserId: "U2", text: "Question" })).toEqual({ channel: "D1", ts: "2.000" });
  expect(await client!.handoff({ handoffId: "handoff-one", toUserId: "U2", text: "Note", blocks: [] })).toEqual({ channel: "D1", ts: "2.000" });
  await client!.handoffResolve("handoff-one", "accepted");
  const handoffs = [{ handoffId: "handoff-one", status: "accepted", byUserId: "U2" }]; test.socket.results.push({ ok: true, handoffs });
  expect(await client!.handoffStatus(["handoff-one"])).toEqual(handoffs);
  expect(test.socket.sent.map((message) => message.operation)).toEqual([
    { kind: "listMembers" }, { kind: "askTeammate", askId: "ask-one", helperUserId: "U2", text: "Question" },
    { kind: "handoff", handoffId: "handoff-one", toUserId: "U2", text: "Note", blocks: [] },
    { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" }, { kind: "handoffStatus", handoffIds: ["handoff-one"] },
  ]);
});

it.each(["G1", "C1"])("accepts only group-DM-shaped top-level helper replies (%s)", async (channel) => {
  const test = await setup(); await test.approve();
  const envelope = helperEnvelope();
  const event: Record<string, unknown> = { ...envelope.payload.event };
  delete event.thread_ts;
  test.socket.incoming({ type: "event", envelope: { ...envelope, channelId: channel, ask: { ...envelope.ask, channel }, payload: { ...envelope.payload, event: { ...event, channel } } } });
  await Promise.resolve();
  expect(test.receive).toHaveBeenCalledTimes(channel.startsWith("G") ? 1 : 0);
});

it.each([helperEnvelope, handoffResultEnvelope, handoffClickEnvelope])("accepts a valid collaboration envelope without triggering an answer or any operation", async (envelope) => {
  const test = await setup(); await test.approve();
  const value = envelope(); test.socket.incoming({ type: "event", envelope: value });
  await vi.waitFor(() => expect(test.receive).toHaveBeenCalledOnce());
  expect(test.receive).toHaveBeenCalledWith(expect.objectContaining({ gateway: { envelope: value, deviceId: test.device.deviceId }, body: value.payload }));
  expect(test.socket.sent).toEqual([]);
});

it.each([
  { kind: "future_kind" }, { teamId: "T2" }, { userId: "U2" }, { deadline: 0 }, { deadline: Number.MAX_SAFE_INTEGER },
  { helper: undefined }, { helper: { userId: "U1", name: "Owner" } }, { helper: { userId: "UBOT", name: "Bot" } },
  { helper: { userId: "C1", name: "Not a user" } }, { helper: { userId: "U2", name: 1 } },
  { ask: { askId: "", channel: "G1", threadTs: "1.000" } }, { ask: { askId: "ask-one", channel: "G2", threadTs: "1.000" } },
  { payload: {} }, { payload: { team_id: "T1", event: { type: "message", user: "U3", channel: "G1", thread_ts: "1.000", text: "Spoofed" } } },
  { handoff: { handoffId: "handoff-one", fromUserId: "U2", fromName: "Helper" } },
])("drops malformed or unknown helper envelopes: %j", async (change) => {
  const test = await setup(); await test.approve();
  test.socket.incoming({ type: "event", envelope: { ...helperEnvelope(), ...change } });
  await Promise.resolve(); expect(test.receive).not.toHaveBeenCalled(); expect(test.socket.readyState).toBe(WebSocket.OPEN);
});

it.each([
  { handoffId: "" }, { status: "pending" }, { status: "failed" }, { status: ["accepted"] }, { byUserId: "U1" }, { byUserId: "UBOT" }, { byUserId: "D1" },
  { payload: {} }, { payload: { handoffId: "other", status: "accepted", byUserId: "U2" } }, { channelId: "D1" },
])("drops malformed handoff-result envelopes: %j", async (change) => {
  const test = await setup(); await test.approve();
  test.socket.incoming({ type: "event", envelope: { ...handoffResultEnvelope(), ...change } });
  await Promise.resolve(); expect(test.receive).not.toHaveBeenCalled(); expect(test.socket.readyState).toBe(WebSocket.OPEN);
});

it.each([
  { kind: "message" }, { handoff: null }, { handoff: { handoffId: "handoff-one", fromUserId: "U1", fromName: "Owner" } },
  { handoff: { handoffId: "handoff-one", fromUserId: "U2", fromName: 1 } }, { payload: {} },
])("drops malformed handoff-click metadata: %j", async (change) => {
  const test = await setup(); await test.approve();
  test.socket.incoming({ type: "event", envelope: { ...handoffClickEnvelope(), ...change } });
  await Promise.resolve(); expect(test.receive).not.toHaveBeenCalled(); expect(test.socket.readyState).toBe(WebSocket.OPEN);
});

it.each([
  undefined, null, [{ userId: "U1", userName: "Self" }], [{ userId: "C1", userName: "Channel" }],
  [{ userId: "U2", userName: 1 }], [{ userId: "U2", userName: "Helper", privateKey: "not allowed" }],
  [{ userId: "U2", userName: "Helper" }, { userId: "U2", userName: "Duplicate" }],
])("rejects malformed member results without retrying: %j", async (members) => {
  const test = await setup(); await test.approve(); test.socket.results.push({ ok: true, members });
  await expect(client!.listMembers()).rejects.toThrow("Invalid gateway result");
  expect(test.socket.sent).toHaveLength(1); expect(test.sleep).not.toHaveBeenCalled();
});

it.each([
  undefined, null, [], [{ handoffId: "other", status: "pending" }], [{ handoffId: "handoff-one", status: "missing" }],
  [{ handoffId: "handoff-one", status: "unknown", byUserId: "U1" }], [{ handoffId: "handoff-one", status: "accepted", byUserId: 123 }],
  [{ handoffId: "handoff-one", status: "pending", text: "not metadata" }], [{ handoffId: "handoff-one", status: ["pending"] }],
])("rejects malformed handoff-status results: %j", async (handoffs) => {
  const test = await setup(); await test.approve(); test.socket.results.push({ ok: true, handoffs });
  await expect(client!.handoffStatus(["handoff-one"])).rejects.toThrow("Invalid gateway result");
  expect(test.socket.sent).toHaveLength(1); expect(test.sleep).not.toHaveBeenCalled();
});

it("validates typed operation inputs before sending", async () => {
  const test = await setup(); await test.approve();
  await expect(client!.askTeammate({ askId: "ask-one", helperUserId: "D1", text: "No" })).rejects.toThrow("Invalid gateway operation");
  await expect(client!.handoffStatus(Array.from({ length: 51 }, (_, index) => `handoff-${index}`))).rejects.toThrow("Invalid gateway operation");
  expect(test.socket.sent).toEqual([]);
});

it.each([
  { handoffId: "handoff-one", status: "unknown" },
  { handoffId: "handoff-one", status: "accepted", byUserId: "U1" },
])("accepts reconciliation metadata for missing receipts and the bound receiver: %j", async (status) => {
  const test = await setup(); await test.approve(); test.socket.results.push({ ok: true, handoffs: [status] });
  expect(await client!.handoffStatus(["handoff-one"])).toEqual([status]);
});

it.each([null, [], { channel: "not-a-channel", ts: "1.000" }, { channel: "D1", ts: 1 }])("rejects malformed receipts without losing the pending promise: %j", async (receipt) => {
  const test = await setup(); await test.approve(); test.socket.results.push({ ok: true, receipt });
  await expect(client!.postMessage({ channel: "D1", text: "Once" })).rejects.toThrow("Invalid gateway result");
  expect(test.socket.readyState).toBe(WebSocket.OPEN); expect(test.socket.sent).toHaveLength(1);
});

it("requires matching Slack action IDs and the receiver's own DM for handoff clicks", async () => {
  const test = await setup(); await test.approve();
  const envelope = handoffClickEnvelope();
  test.socket.incoming({ type: "event", envelope: { ...envelope, payload: { ...envelope.payload, actions: [{ type: "button", action_id: "devhub_confirm_answer", value: "{}" }] } } });
  test.socket.incoming({ type: "event", envelope: { ...envelope, channelId: "D2", payload: { ...envelope.payload, channel: { id: "D2" } } } });
  await Promise.resolve(); expect(test.receive).not.toHaveBeenCalled();
});
