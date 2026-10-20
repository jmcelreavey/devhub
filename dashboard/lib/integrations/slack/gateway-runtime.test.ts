import { afterEach, expect, it, vi } from "vitest";
import type { SlackEnvelope, SlackTransport } from "./client";
import type { SlackSettings } from "./shared";
vi.mock("./settings", async (original) => ({ ...await original<typeof import("./settings")>(), slackConfigured: () => true }));
vi.mock("./gateway-state", () => ({ gatewayPairingStatus: () => undefined, gatewayStateRoot: () => "/unused" }));
import { SlackRuntime, type SlackDependencies } from "./runtime";
import { buildSlackAnswer } from "./answers";
import { routeSlackMessage } from "./router";
import { SlackToolRouter } from "./tool-handler";
import { toSlackTool } from "./mcp-catalog";
import { LOCK_HEARTBEAT_MS } from "./process-lock";

const runtimes: SlackRuntime[] = [];
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.stop(); });

function setup() {
  const settings: SlackSettings = { mode: "gateway", gatewayUrl: "https://gateway.test", deviceId: "device-one", teamId: "T1", allowedUserId: "U1", channelId: "D1", botToken: "", appToken: "" };
  let listener: (envelope: SlackEnvelope) => Promise<void> = async () => {};
  let state: Parameters<SlackTransport["onState"]>[0] = () => {};
  const client: SlackTransport = {
    authenticate: vi.fn(async () => ({ teamId: "T1", userId: "UBOT", name: "DevHub" })), start: vi.fn(async () => state("connected")), stop: vi.fn(async () => {}),
    postMessage: vi.fn(async (message) => ({ channel: message.channel, ts: "2.000" })), updateMessage: vi.fn(async () => {}), publishHome: vi.fn(async () => {}),
    onEnvelope: (next) => { listener = next; }, onState: (next) => { state = next; }, unlink: vi.fn(async () => {}),
  };
  const tools = { handle: vi.fn(async (_text: string, context: { channel: string; threadTs?: string }) => [{ channel: context.channel, thread_ts: context.threadTs, text: "handled locally" }]), interact: vi.fn(async () => ({ post: [] })), recordRule: vi.fn(), close: vi.fn(async () => {}) };
  const needs = { reset: vi.fn(), tick: vi.fn(async () => {}), reply: vi.fn(async () => ({ handled: false })), interact: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const dependencies: SlackDependencies = {
    createClient: vi.fn(() => client), readSettings: () => settings, primary: vi.fn(() => true), context: () => ({ activeProfile: "work", profiles: ["work"] }),
    answer: vi.fn(() => buildSlackAnswer({ kind: "unknown", profile: "work" })), claim: vi.fn(async () => true), reserveSend: async () => 0, wait: async () => {},
    createNeedsYou: vi.fn(() => needs), tools, buildHome: vi.fn(async () => ({ type: "home" as const, blocks: [] })),
  };
  const runtime = new SlackRuntime(dependencies); runtimes.push(runtime);
  const body = { team_id: "T1", event_id: "event", event: { type: "message", user: "U1", channel: "C1", text: "<@UBOT> run fake_release", ts: "1.000" } };
  const envelope: SlackEnvelope = { envelopeId: "event", type: "events_api", body, acknowledge: async () => {}, gateway: { deviceId: "device-one", envelope: { id: "event", kind: "message", teamId: "T1", userId: "U1", channelId: "C1", threadTs: "1.000", payload: body, deadline: Date.now() + 120000 } } };
  return { runtime, dependencies, client, tools, needs, envelope, emit: (event: SlackEnvelope) => listener(event) };
}

it("dispatches authenticated gateway events through the same local handlers, not the direct allowlist channel", async () => {
  const test = setup(); await test.runtime.refresh();
  await test.emit({ ...test.envelope, gateway: undefined }); expect(test.tools.handle).not.toHaveBeenCalled();
  await test.emit({ ...test.envelope, gateway: { ...test.envelope.gateway!, deviceId: "other-device" } }); expect(test.tools.handle).not.toHaveBeenCalled();
  await test.emit(test.envelope);
  expect(test.tools.handle).toHaveBeenCalledWith("run fake_release", expect.objectContaining({ channel: "C1", userId: "U1", teamId: "T1" }));
  expect(test.client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "C1" }));
  expect(test.dependencies.createNeedsYou).toHaveBeenCalledWith(expect.anything(), { teamId: "T1", userId: "U1", channel: "D1", deviceId: "device-one" }, expect.anything());
  const body = { type: "block_actions", team: { id: "T1" }, user: { id: "U1" }, channel: { id: "C1" }, container: { type: "message", channel_id: "C1", message_ts: "2.000" }, message: { ts: "2.000" }, actions: [{ type: "button", action_id: "devhub_tool_confirm", value: "confirm", action_ts: "3.000" }] };
  await test.emit({ ...test.envelope, envelopeId: "click", type: "interactive", body, gateway: { deviceId: "device-one", envelope: { ...test.envelope.gateway!.envelope, id: "click", kind: "block_actions", payload: body, threadTs: "2.000" } } });
  expect(test.tools.interact).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "device-one", userId: "U1", channelId: "C1" }));
});

it("answers gateway-relayed capabilities from this device’s catalog, including its plugin", async () => {
  const test = setup();
  const localTools = [
    toSlackTool({ name: "tasks_list", description: "Local tasks", annotations: { readOnlyHint: true }, _meta: { "devhub/toolset": "tasks" } })!,
    toSlackTool({ name: "company_local_tool", description: "Only installed on this laptop", annotations: { readOnlyHint: true }, _meta: { "devhub/plugin": "company", "devhub/toolset": "plugin:company" } })!,
  ];
  const catalog = { tools: vi.fn(async () => localTools), call: vi.fn(), close: vi.fn(async () => {}) };
  const jev = vi.fn(); const model = vi.fn();
  test.dependencies.tools = new SlackToolRouter({ catalog, jev, model, confirms: { create: vi.fn(), claim: vi.fn() }, record: vi.fn(), totals: () => ({ date: "2026-10-19", queries: 0, rules: 0, jevCalls: 0, jevCostUsd: 0, modelCalls: 0 }), deviceLabel: () => "Asker’s MacBook" });
  vi.mocked(test.dependencies.answer).mockImplementation((text, context) => buildSlackAnswer(routeSlackMessage(text, context)));
  await test.runtime.refresh();
  const body = { team_id: "T1", event_id: "capabilities", event: { type: "message", user: "U1", channel: "C1", text: "<@UBOT> what can you do?", ts: "8.000", thread_ts: "7.000" } };
  await test.emit({ ...test.envelope, envelopeId: "capabilities", body, gateway: { ...test.envelope.gateway!, envelope: { ...test.envelope.gateway!.envelope, id: "capabilities", threadTs: "7.000", payload: body } } });
  expect(catalog.tools).toHaveBeenCalledExactlyOnceWith("work");
  expect(test.client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "C1", thread_ts: "7.000", text: expect.stringContaining("Plugin: company") }));
  expect(vi.mocked(test.client.postMessage).mock.calls[0][0].text).toContain("From Asker’s MacBook · 2 tools");
  expect(jev).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled(); expect(catalog.call).not.toHaveBeenCalled();
});

it("ignores shared-channel chatter before either router, model, thread handler or reply", async () => {
  const test = setup(); await test.runtime.refresh();
  for (const text of ["my tickets", "my assigned tasks", "could you investigate this?", "<@UOTHER> prs"]) {
    const body = { team_id: "T1", event: { type: "message", user: "U1", channel: "C1", text, ts: "3.000", thread_ts: "unknown.000" }, event_id: text };
    await test.emit({ ...test.envelope, envelopeId: text, body, gateway: { ...test.envelope.gateway!, envelope: { ...test.envelope.gateway!.envelope, id: text, threadTs: "unknown.000", payload: body } } });
  }
  expect(test.dependencies.answer).not.toHaveBeenCalled(); expect(test.tools.handle).not.toHaveBeenCalled();
  expect(test.needs.reply).not.toHaveBeenCalled(); expect(test.client.postMessage).not.toHaveBeenCalled();
  expect(test.dependencies.claim).not.toHaveBeenCalled();
});

it("accepts DMs and replies only in a locally recognised bot thread", async () => {
  const test = setup(); await test.runtime.refresh();
  await test.emit(test.envelope);
  const send = async (channel: string, threadTs: string, text: string) => {
    const body = { team_id: "T1", event_id: text, event: { type: "message", user: "U1", channel, text, ts: "3.000", thread_ts: threadTs } };
    await test.emit({ ...test.envelope, envelopeId: text, body, gateway: { ...test.envelope.gateway!, envelope: { ...test.envelope.gateway!.envelope, id: text, channelId: channel, threadTs, payload: body } } });
  };
  await send("C1", "1.000", "recognised reply");
  await send("C2", "1.000", "another channel");
  await send("D1", "4.000", "private message");
  expect(test.tools.handle.mock.calls.map(([text]) => text)).toEqual(["run fake_release", "recognised reply", "private message"]);
});

it.each(["prs", "meetings today", "what time is it"])("normalises a leading bot mention once before both routers: %s", async (text) => {
  const test = setup(); await test.runtime.refresh();
  const body = { team_id: "T1", event_id: text, event: { type: "message", user: "U1", channel: "C1", text: `<@UBOT> ${text}`, ts: "1.000" } };
  await test.emit({ ...test.envelope, body, gateway: { ...test.envelope.gateway!, envelope: { ...test.envelope.gateway!.envelope, payload: body } } });
  expect(test.dependencies.answer).toHaveBeenCalledWith(text, expect.anything());
  expect(test.tools.handle).toHaveBeenCalledWith(text, expect.anything());
});

it("honours the scheduler guard and cross-process lock before opening a device socket", async () => {
  const test = setup(); vi.mocked(test.dependencies.primary).mockReturnValue(false); await test.runtime.refresh();
  expect(test.dependencies.createClient).not.toHaveBeenCalled();
  vi.mocked(test.dependencies.primary).mockReturnValue(true); test.dependencies.acquireLock = () => ({ ok: false, holderPid: 123 }); await test.runtime.refresh();
  expect(test.dependencies.createClient).not.toHaveBeenCalled(); expect(test.runtime.status().connection.state).toBe("disabled");
});

it("can stop while waiting for pairing instead of deadlocking the runtime refresh queue", async () => {
  const test = setup();
  let cancel: ((error: Error) => void) | undefined;
  vi.mocked(test.client.authenticate).mockImplementation(() => new Promise((_resolve, reject) => { cancel = reject; }));
  vi.mocked(test.client.stop).mockImplementation(async () => { cancel?.(new Error("stopped")); });
  const starting = test.runtime.refresh(); await vi.waitFor(() => expect(test.client.authenticate).toHaveBeenCalled());
  await test.runtime.stop(); await starting; expect(test.client.stop).toHaveBeenCalled();
});

it("stops safely if an atomic heartbeat cannot be written", async () => {
  vi.useFakeTimers();
  const test = setup();
  const release = vi.fn();
  test.dependencies.acquireLock = () => ({ ok: true, lock: { held: () => true, heartbeat: () => { throw new Error("disk unavailable"); }, release } });
  try {
    await test.runtime.refresh();
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS);
    expect(test.client.stop).toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
    expect(test.runtime.status().connection.state).toBe("error");
  } finally { await test.runtime.stop(); vi.useRealTimers(); }
});
