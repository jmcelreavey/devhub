import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SlackGateway, OFFLINE, UNLINKED } from "../../../../gateway/src/gateway";
import { Registry } from "../../../../gateway/src/registry";
import { HANDOFF_DECLINE_ACTION, HANDOFF_PICKUP_ACTION, record, type GatewayOperation, type GatewaySlackOperation } from "@shared/slack-gateway/protocol";
import { isTaskReadyForAgent } from "@shared/tasks/types.ts";
import { teamFixture } from "@/lib/team/fixtures.test-helper";
import { createGatewayClient } from "./gateway-client";
import { confirmGatewayBinding, readGatewayDevice, registerGatewayDevice, type SlackGatewayDevice } from "./gateway-state";
import { allowedGatewayEnvelope, allowedSlackInteraction, allowedSlackMessage, type SlackInteraction } from "./security";
import { ToolConfirmStore } from "./tool-confirm-store";
import { SlackToolRouter } from "./tool-handler";
import type { SlackTool } from "./mcp-catalog";
import type { SlackSettings } from "./shared";
import type { SlackTransport } from "./client";
import { normalizeSlackCommand } from "./slack-text";

let gateway: SlackGateway | undefined;
const clients: SlackTransport[] = [];
const roots: string[] = [];
const teamFixtures: ReturnType<typeof teamFixture>[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop();
  await gateway?.close();
  for (const fixture of teamFixtures.splice(0)) fixture.cleanup();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it.each(["accepted", "declined", "lost-ack"] as const)("routes ask approval and a handoff that is %s through two real device transports", async (outcome) => {
  const accepted = outcome !== "declined";
  const posts: { channel: string; ts: string; operation: Extract<GatewaySlackOperation, { kind: "postMessage" }> }[] = [];
  const errors: unknown[] = [];
  const routed = vi.fn();
  let sequence = 100;
  const registry = new Registry();
  const identity = { userId: "UBOT", teamId: "T1", name: "DevHub" };
  gateway = new SlackGateway({ registry, slack: {
    identity,
    member: async (userId) => ({ name: userId === "U1" ? "owner" : "helper", dmChannelId: userId === "U1" ? "D1" : "D2" }),
    openGroupDm: async () => "GASK",
    execute: async (operation) => {
      if (operation.kind !== "postMessage") return;
      const receipt = { channel: operation.channel, ts: String(sequence++) + ".000" };
      posts.push({ ...receipt, operation });
      return receipt;
    },
  } });
  const url = "http://127.0.0.1:" + await gateway.listen();
  const devices: ReturnType<typeof teamFixture>[] = [];
  for (const userId of ["U1", "U2"]) {
    const current = teamFixture(userId);
    teamFixtures.push(current);
    await registerGatewayDevice(url, current.root);
    const device = readGatewayDevice(current.root)!;
    const settings: SlackSettings = { mode: "gateway", gatewayUrl: url, deviceId: device.deviceId, botToken: "", appToken: "", teamId: "", allowedUserId: "", channelId: "" };
    const client = createGatewayClient(settings, { root: current.root });
    clients.push(client);
    current.env.client = client;
    current.env.audience().deviceId = device.deviceId;
    current.env.post.mockImplementation((message) => client.postMessage(message));
    current.env.update.mockImplementation((message) => client.updateMessage(message));
    client.onEnvelope(async (envelope) => {
      try {
        expect(allowedGatewayEnvelope(envelope, settings)).toBe(true);
        if (envelope.gateway && await current.service.event(envelope.gateway.envelope)) return;
        const scoped = { ...settings, channelId: envelope.gateway?.envelope.channelId ?? settings.channelId };
        if (envelope.type === "interactive") {
          const interaction: SlackInteraction | null = allowedSlackInteraction(envelope.body, scoped, identity);
          expect(interaction).not.toBeNull();
          if (!interaction) return;
          interaction.deviceId = device.deviceId;
          if (await current.service.interact(interaction)) return;
        } else {
          const message = allowedSlackMessage(envelope.body, scoped, identity);
          if (message && current.service.asks.ignores(message.channelId, message.threadTs)) return;
        }
        routed();
      } catch (error) { errors.push(error); }
    });
    const authenticated = client.authenticate();
    await gateway.command("T1", userId, "link " + device.code);
    await vi.waitFor(() => expect(readGatewayDevice(current.root)?.binding?.userId).toBe(userId));
    confirmGatewayBinding(device.deviceId, userId, current.root);
    await client.authenticate();
    await authenticated;
    await client.start();
    devices.push(current);
  }
  const [owner, helper] = devices;
  const ask = await owner.service.ask(owner.task.id, "helper");
  await gateway.receive({ team_id: "T1", event_id: "helper-reply", event: { type: "message", user: "U2", channel: ask.channel, text: "Keep the cached result", ts: "201.000" } }, "helper-reply");
  await vi.waitFor(() => expect(posts.some((post) => post.operation.text === "Suggested answer from @helper")).toBe(true));
  expect(owner.env.deps.answer).not.toHaveBeenCalled();
  expect(helper.env.deps.answer).not.toHaveBeenCalled();
  const suggestion = posts.find((post) => post.operation.text === "Suggested answer from @helper")!;
  const click = (userId: string, card: typeof suggestion, actionId: string, eventId: string) => {
    const action = (card.operation.blocks ?? []).flatMap((block) => {
      const elements = record(block).elements;
      return Array.isArray(elements) ? elements.map(record) : [];
    }).find((element) => element.action_id === actionId);
    expect(action).toBeDefined();
    return gateway!.receive({ type: "block_actions", team: { id: "T1" }, user: { id: userId }, channel: { id: card.channel }, container: { type: "message", channel_id: card.channel, message_ts: card.ts }, message: { ts: card.ts, blocks: card.operation.blocks }, actions: [{ ...action, action_ts: String(sequence++) + ".000" }] }, eventId);
  };
  await click("U2", suggestion, "devhub_team_send", "helper-forged-answer");
  expect(owner.env.deps.answer).not.toHaveBeenCalled();
  await click("U1", suggestion, "devhub_team_send", "owner-answer");
  await vi.waitFor(() => expect(owner.env.deps.answer).toHaveBeenCalledExactlyOnceWith("work", owner.task.id, "Keep the cached result", expect.any(String)));
  await click("U1", suggestion, "devhub_team_send", "owner-answer-replay");
  expect(owner.env.deps.answer).toHaveBeenCalledOnce();
  const preview = await owner.service.handoff(owner.task.id, "helper");
  await owner.service.handoffs.postPreview(preview);
  const confirmation = posts.find((post) => post.operation.text === "Hand off to @helper?")!;
  await click("U1", confirmation, "devhub_team_confirm", "owner-handoff");
  await vi.waitFor(() => expect(posts.some((post) => post.operation.text.startsWith("@owner wants to hand you"))).toBe(true));
  const receiver = posts.find((post) => post.operation.text.startsWith("@owner wants to hand you"))!;
  const handoffId = owner.task.handoff!.handoffId;
  expect(owner.task.handoff?.status).toBe("pending");
  expect(isTaskReadyForAgent(owner.task)).toBe(false);
  expect(owner.env.deps.push).toHaveBeenCalledOnce();
  await click("U1", receiver, HANDOFF_PICKUP_ACTION, "owner-forged-pickup");
  expect(helper.env.deps.createPickup).not.toHaveBeenCalled();
  if (outcome === "lost-ack") {
    const resolve = helper.env.client.handoffResolve.bind(helper.env.client);
    vi.spyOn(helper.env.client, "handoffResolve").mockImplementationOnce(async (id, status) => { await resolve(id, status); throw new Error("Acceptance reply lost"); });
  }
  const actionId = accepted ? HANDOFF_PICKUP_ACTION : HANDOFF_DECLINE_ACTION;
  await click("U2", receiver, actionId, "receiver-outcome");
  await vi.waitFor(() => expect(owner.task.handoff?.status).toBe(accepted ? "accepted" : undefined));
  if (accepted) {
    await vi.waitFor(() => expect(helper.env.deps.finishPickup).toHaveBeenCalledOnce());
    expect(isTaskReadyForAgent(owner.task)).toBe(false);
    expect(isTaskReadyForAgent(helper.tasks.get(handoffId)!)).toBe(true);
    expect(helper.env.deps.assignJira).toHaveBeenCalledExactlyOnceWith("APP-1", handoffId);
    expect(owner.env.deps.assignJira).not.toHaveBeenCalled();
    expect(helper.env.deps.writeNote).toHaveBeenCalledWith(expect.anything(), "work", expect.stringContaining("Keep the last result?"));
  } else {
    expect(isTaskReadyForAgent(owner.task)).toBe(true);
    expect(helper.env.deps.createPickup).not.toHaveBeenCalled();
  }
  expect(await owner.env.client.handoffStatus([handoffId])).toEqual([expect.objectContaining({ handoffId, status: accepted ? "accepted" : "declined" })]);
  await click("U2", receiver, actionId, "receiver-outcome-replay");
  expect(helper.env.deps.createPickup).toHaveBeenCalledTimes(accepted ? 1 : 0);
  expect(routed).not.toHaveBeenCalled();
  expect(errors).toEqual([]);
});

it("keeps two laptops' routing, local plugins and single-use Confirm cards separate end to end", async () => {
  const operations: GatewayOperation[] = [];
  const metadata: unknown[] = [];
  let sequence = 10;
  const registry = new Registry();
  const identity = { userId: "UBOT", teamId: "T1", name: "DevHub" };
  gateway = new SlackGateway({ registry, slack: {
    identity, member: async (userId) => ({ name: userId, dmChannelId: userId === "U1" ? "D1" : "D2" }),
    execute: async (operation) => { operations.push(operation); if (operation.kind === "postMessage") return { channel: operation.channel, ts: `${sequence++}.000` }; },
  }, log: (entry) => metadata.push(entry) });
  const url = `http://127.0.0.1:${await gateway.listen()}`;
  const plugin: SlackTool = { name: "fake_release", description: "Release from a local-only plugin", category: "plugin:one", plugin: "one", readOnly: false, destructive: true, inputSchema: { type: "object", properties: {}, required: [] } };
  const executions = [vi.fn(async () => ({ text: "Local plugin released", isError: false })), vi.fn(async () => ({ text: "not available", isError: true }))];
  const received: string[][] = [[], []];
  const devices: { client: SlackTransport; settings: SlackSettings; state: SlackGatewayDevice; errors: unknown[] }[] = [];
  for (const [index, userId] of ["U1", "U2"].entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-device-test-")); roots.push(root);
    await registerGatewayDevice(url, root);
    const state = readGatewayDevice(root)!;
    const settings: SlackSettings = { mode: "gateway", gatewayUrl: url, deviceId: state.deviceId, botToken: "", appToken: "", teamId: "", allowedUserId: "", channelId: "" };
    const confirms = new ToolConfirmStore(path.join(root, "confirm"), Date.now, () => state.deviceId);
    const handler = new SlackToolRouter({
      catalog: { tools: async () => index === 0 ? [plugin] : [], call: executions[index], close: async () => {} },
      jev: vi.fn(async () => { throw new Error("No external routing in this test"); }), model: vi.fn(async () => ({ ok: false as const, reason: "no-cheap-tier" as const })),
      confirms, record: () => {}, totals: () => ({ date: "2026-10-18", queries: 0, rules: 0, jevCalls: 0, jevCostUsd: 0, modelCalls: 0 }),
    });
    const client = createGatewayClient(settings, { root }); clients.push(client);
    const errors: unknown[] = [];
    client.onEnvelope(async (envelope) => {
      try {
        expect(allowedGatewayEnvelope(envelope, settings)).toBe(true);
        received[index].push(envelope.envelopeId);
        const scoped = { ...settings, channelId: envelope.gateway?.envelope.channelId ?? settings.channelId };
        if (envelope.type === "interactive") {
          const action: SlackInteraction | null = allowedSlackInteraction(envelope.body, scoped, identity);
          if (!action) return;
          action.deviceId = state.deviceId;
          const reply = await handler.interact(action);
          if (reply.update) await client.updateMessage({ ...reply.update, ts: action.ts });
          for (const message of reply.post) await client.postMessage(message);
        } else {
          const message = allowedSlackMessage(envelope.body, scoped, identity);
          if (!message) return;
          for (const reply of await handler.handle(normalizeSlackCommand(message.text, identity.userId), { profile: "work", teamId: message.teamId, userId: message.userId, channel: message.channelId, threadTs: message.threadTs ?? message.ts })) await client.postMessage(reply);
        }
      } catch (error) { errors.push(error); }
    });
    const authenticated = client.authenticate();
    await gateway.command("T1", userId, `link ${state.code}`);
    await vi.waitFor(() => expect(readGatewayDevice(root)?.binding?.userId).toBe(userId));
    confirmGatewayBinding(state.deviceId, userId, root); await client.authenticate();
    expect(await authenticated).toEqual(identity);
    expect(readGatewayDevice(root)?.binding?.userId).toBe(userId);
    await client.start();
    devices.push({ client, settings, state, errors });
  }
  const message = (user: string, text: string, ts: string) => ({ team_id: "T1", event_id: `event-${ts}`, event: { type: "message", user, channel: "CTEAM", text: `<@UBOT> ${text}`, ts } });
  await gateway.receive(message("U1", "run fake_release", "1.000"), "u1-plugin");
  await vi.waitFor(() => expect(operations.some((operation) => operation.kind === "postMessage" && operation.channel === "CTEAM")).toBe(true));
  const card = operations.find((operation) => operation.kind === "postMessage" && operation.channel === "CTEAM")!;
  const blocks = "blocks" in card ? card.blocks : undefined;
  const actions = blocks?.find((block) => (block as { type: string }).type === "actions") as { elements: { action_id: string; value: string; style?: string }[] };
  const confirm = actions.elements.find((button) => button.action_id === "devhub_tool_confirm")!;
  expect(confirm.style).toBe("danger");
  expect(JSON.stringify(card)).toContain("can't be undone");
  expect(executions[0]).not.toHaveBeenCalled();
  expect(received[0]).toEqual(["u1-plugin"]); expect(received[1]).toEqual([]);
  await expect(devices[0].client.postMessage({ channel: "D2", text: "forbidden" })).rejects.toThrow("refused");
  await expect(devices[0].client.publishHome("U2", { type: "home", blocks: [] })).rejects.toThrow("refused");
  const click = (userId: string, actionTs: string) => ({ type: "block_actions", team: { id: "T1" }, user: { id: userId }, channel: { id: "CTEAM" },
    container: { type: "message", channel_id: "CTEAM", message_ts: "12.000" }, message: { ts: "12.000", thread_ts: "1.000" },
    actions: [{ type: "button", action_id: "devhub_tool_confirm", value: confirm.value, action_ts: actionTs }] });
  await gateway.receive(click("U2", "20.000"), "wrong-member");
  expect(operations.at(-1)).toMatchObject({ channel: "D2", text: expect.stringContaining("another session or member") });
  expect(received[1]).toEqual([]); expect(executions[0]).not.toHaveBeenCalled();
  await gateway.receive(click("U1", "21.000"), "confirm");
  await vi.waitFor(() => expect(executions[0]).toHaveBeenCalledTimes(1));
  await gateway.receive(click("U1", "22.000"), "confirm-replay");
  await vi.waitFor(() => expect(operations.some((operation) => "text" in operation && operation.text.includes("already handled"))).toBe(true));
  expect(executions[0]).toHaveBeenCalledTimes(1);
  await gateway.receive(message("U2", "run fake_release", "2.000"), "u2-plugin");
  await vi.waitFor(() => expect(operations.some((operation) => "text" in operation && operation.text.includes("not available on this DevHub"))).toBe(true));
  expect(received[1]).toEqual(["u2-plugin"]); expect(executions[1]).not.toHaveBeenCalled();
  await devices[1].client.stop();
  await vi.waitFor(() => expect(devices[1].errors).toEqual([]));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await gateway.receive(message("U2", "not queued", "3.000"), "offline");
  await vi.waitFor(() => expect(operations.at(-1)).toMatchObject({ channel: "D2", text: OFFLINE }));
  expect(received[1]).toEqual(["u2-plugin"]);
  const resumed = createGatewayClient(devices[1].settings, { root: roots[1] }); clients.push(resumed);
  const backlogged = vi.fn(async () => {}); resumed.onEnvelope(backlogged);
  await resumed.authenticate(); await resumed.start(); expect(backlogged).not.toHaveBeenCalled();
  const proactive = await devices[0].client.postMessage({ channel: "D1", text: "Needs you" });
  await devices[0].client.updateMessage({ ...proactive, text: "Progress updated" });
  await devices[0].client.publishHome("U1", { type: "home", blocks: [] });
  expect(operations.at(-1)).toMatchObject({ kind: "viewsPublish", userId: "U1" });
  await resumed.unlink!();
  expect(readGatewayDevice(roots[1])?.revoked).toBe(true); expect(registry.member("T1", "U2")).toBeUndefined();
  await gateway.command("T1", "U1", "unlink");
  await vi.waitFor(() => expect(readGatewayDevice(roots[0])?.revoked).toBe(true));
  expect(registry.member("T1", "U1")).toBeUndefined();
  await gateway.receive(message("U1", "after unlink", "4.000"), "unlinked"); expect(operations.at(-1)).toMatchObject({ text: UNLINKED });
  expect(devices.flatMap((device) => device.errors)).toEqual([]);
  expect(JSON.stringify(metadata)).not.toMatch(/fake_release|PUBLIC KEY|not queued/);
});
