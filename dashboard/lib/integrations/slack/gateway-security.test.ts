import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowedGatewayEnvelope } from "./security";
import type { SlackEnvelope } from "./client";
import type { SlackSettings } from "./shared";
import { ToolConfirmStore, CONFIRM_TTL_MS } from "./tool-confirm-store";

const settings: SlackSettings = { mode: "gateway", gatewayUrl: "https://gateway.test", deviceId: "device-one", teamId: "T1", allowedUserId: "U1", channelId: "D1", botToken: "", appToken: "" };
function envelope(): SlackEnvelope {
  const body = { team_id: "T1", event_id: "event", event: { type: "message", user: "U1", channel: "C1", text: "hello", ts: "1.000" } };
  return { envelopeId: "envelope", type: "events_api", body, acknowledge: async () => {}, gateway: { deviceId: "device-one", envelope: { id: "envelope", kind: "message", teamId: "T1", userId: "U1", channelId: "C1", threadTs: "1.000", payload: body, deadline: 10000 } } };
}

describe("gateway-mode security", () => {
  it("requires an authenticated matching device and locally linked owner", () => {
    expect(allowedGatewayEnvelope(envelope(), settings, 1000)).toBe(true);
    expect(allowedGatewayEnvelope({ ...envelope(), gateway: undefined }, settings, 1000)).toBe(false);
    expect(allowedGatewayEnvelope(envelope(), { ...settings, deviceId: "other" }, 1000)).toBe(false);
    expect(allowedGatewayEnvelope(envelope(), { ...settings, allowedUserId: "U2" }, 1000)).toBe(false);
    expect(allowedGatewayEnvelope(envelope(), { ...settings, teamId: "T2" }, 1000)).toBe(false);
  });
  it("rejects expired, future-skewed, mismatched and forged payload metadata", () => {
    expect(allowedGatewayEnvelope(envelope(), settings, 10000)).toBe(false);
    expect(allowedGatewayEnvelope(envelope(), settings, -200000)).toBe(false);
    expect(allowedGatewayEnvelope({ ...envelope(), envelopeId: "other" }, settings, 1000)).toBe(false);
    const incoming = envelope();
    incoming.body = { team_id: "T1", event: { type: "message", user: "U2", channel: "C1", ts: "1.000" } };
    expect(allowedGatewayEnvelope(incoming, settings, 1000)).toBe(false);
    incoming.body = { team_id: "T1", event: { type: "message", user: "U1", channel: "C2", ts: "1.000" } };
    expect(allowedGatewayEnvelope(incoming, settings, 1000)).toBe(false);
  });
  it("does not accept gateway envelopes on direct transport", () => {
    expect(allowedGatewayEnvelope(envelope(), { ...settings, mode: "direct" }, 1000)).toBe(false);
    expect(allowedGatewayEnvelope({ ...envelope(), gateway: undefined }, { ...settings, mode: undefined }, 1000)).toBe(true);
  });
});

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const input = { kind: "run" as const, tool: "fake_write", args: { content: "only this" }, teamId: "T1", userId: "U1", channel: "C1", profile: "work" };
const who = { teamId: "T1", userId: "U1", channel: "C1", deviceId: "device-one" };
function store(now = () => 1000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-confirm-")); roots.push(root);
  return new ToolConfirmStore(root, now, () => "device-one");
}

describe("gateway Confirm binding", () => {
  it("rejects another user/device and preserves single-use on the right device", async () => {
    const confirms = store(); const id = await confirms.create(input);
    expect(await confirms.claim(id, { ...who, userId: "U2" })).toMatchObject({ ok: false, reason: "wrong-user" });
    expect(await confirms.claim(id, { ...who, deviceId: "device-two" })).toMatchObject({ ok: false, reason: "wrong-user" });
    expect(await confirms.claim(id, { ...who, deviceId: undefined })).toMatchObject({ ok: false, reason: "wrong-user" });
    expect(await confirms.claim(id, who)).toMatchObject({ ok: true });
    expect(await confirms.claim(id, who)).toMatchObject({ ok: false, reason: "used" });
  });
  it.each(["args", "nonce"])("refuses tampering with %s", async (field) => {
    const confirms = store(); const id = await confirms.create(input);
    const file = path.join(confirms.root, "tool-confirm.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.entries[id][field] = field === "args" ? { content: "something else" } : "wrong-nonce";
    fs.writeFileSync(file, JSON.stringify(state));
    expect(await confirms.claim(id, who)).toMatchObject({ ok: false, reason: "wrong-user" });
  });
  it("expires and refuses a direct-mode card on a gateway device", async () => {
    let now = 1000; const confirms = store(() => now); const id = await confirms.create(input);
    now += CONFIRM_TTL_MS + 1;
    expect(await confirms.claim(id, who)).toMatchObject({ ok: false, reason: "expired" });
    const direct = new ToolConfirmStore(confirms.root, () => now, () => undefined);
    expect(await confirms.claim(await direct.create(input), who)).toMatchObject({ ok: false, reason: "wrong-user" });
  });
});
