import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gatewaySocketUrl, gatewayUrl } from "@shared/slack-gateway/protocol";
import { acceptGatewayBinding, confirmGatewayBinding, gatewayPairingStatus, gatewayStateRoot, readGatewayDevice, registerGatewayDevice, revokeGatewayDevice } from "./gateway-state";
import { readSlackSettings, saveSlackSettings, slackConfigured, SLACK_ENV_KEYS } from "./settings";
import { SlackSettingsSchema } from "./shared";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-gateway-state-"));
  vi.stubEnv("XDG_STATE_HOME", root); vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, ".env.local"));
  for (const key of Object.values(SLACK_ENV_KEYS)) vi.stubEnv(key, "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const binding = (deviceId: string) => ({ deviceId, teamId: "T1", userId: "U1", userName: "one", dmChannelId: "D1" });
const registration = () => vi.fn(async () => new Response(JSON.stringify({ deviceId: randomUUID(), code: "ABCD2345", expiresAt: Date.now() + 600000 }), { status: 201 }));

it("keeps the Ed25519 private key in private local state and never returns it to Setup", async () => {
  const request = registration(); await registerGatewayDevice("https://gateway.test", undefined, request);
  const device = readGatewayDevice()!;
  expect(device.privateKey).toContain("PRIVATE KEY"); expect(device.publicKey).toContain("PUBLIC KEY");
  expect(fs.statSync(path.join(gatewayStateRoot(), "gateway-device.json")).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(gatewayPairingStatus())).not.toMatch(/PRIVATE KEY|PUBLIC KEY/);
  expect(request.mock.calls).toHaveLength(1);
  await registerGatewayDevice("https://gateway.test", undefined, request); expect(request).toHaveBeenCalledTimes(1);
  acceptGatewayBinding(device.deviceId, binding(device.deviceId));
  expect(gatewayPairingStatus()?.binding?.userId).toBe("U1"); expect(gatewayPairingStatus()?.code).toBeUndefined();
  expect(gatewayPairingStatus()?.pending).toBe(true);
  expect(() => confirmGatewayBinding(device.deviceId, "U2")).toThrow("binding changed");
  confirmGatewayBinding(device.deviceId, "U1"); expect(gatewayPairingStatus()?.pending).toBe(false);
  expect(() => acceptGatewayBinding(device.deviceId, { ...binding(device.deviceId), userId: "U2" })).toThrow("owner changed");
  revokeGatewayDevice(); expect(gatewayPairingStatus()?.revoked).toBe(true);
});

it("does not overwrite direct credentials or allow manual gateway owner fields", async () => {
  const direct = { botToken: "xoxb-fake", appToken: "xapp-fake", channelId: "CORIGINAL", allowedUserId: "UORIGINAL", teamId: "TORIGINAL", postNeedsYou: true, postProgress: true };
  saveSlackSettings(direct);
  expect(readSlackSettings()).toEqual(direct);
  await registerGatewayDevice("https://gateway.test", undefined, registration());
  saveSlackSettings({ mode: "gateway", gatewayUrl: "https://gateway.test" });
  expect(slackConfigured(readSlackSettings())).toBe(true);
  expect(readSlackSettings().allowedUserId).toBe("");
  const device = readGatewayDevice()!;
  acceptGatewayBinding(device.deviceId, binding(device.deviceId));
  expect(readSlackSettings().allowedUserId).toBe("");
  confirmGatewayBinding(device.deviceId, "U1");
  expect(readSlackSettings()).toMatchObject({ allowedUserId: "U1", channelId: "D1", teamId: "T1", deviceId: device.deviceId });
  saveSlackSettings({ postNeedsYou: false }); saveSlackSettings({ mode: "direct" });
  expect(readSlackSettings()).toEqual({ ...direct, postNeedsYou: false, mode: "direct", gatewayUrl: "https://gateway.test" });
  expect(SlackSettingsSchema.safeParse({ deviceId: "forged" }).success).toBe(false);
});

it("requires a trusted URL, matching device state and successful registration", async () => {
  for (const url of ["http://remote.test", "https://user:password@gateway.test", "https://gateway.test/path", "https://gateway.test?token=secret", "file:///tmp/test"]) {
    expect(() => gatewayUrl(url)).toThrow(); expect(SlackSettingsSchema.safeParse({ gatewayUrl: url }).success).toBe(false);
  }
  expect(gatewaySocketUrl("http://127.0.0.1:1234")).toBe("ws://127.0.0.1:1234/device");
  expect(gatewaySocketUrl("wss://gateway.test")).toBe("wss://gateway.test/device");
  await expect(registerGatewayDevice("https://gateway.test", undefined, vi.fn(async () => new Response("{}", { status: 429 })))).rejects.toThrow("couldn't register");
  expect(readGatewayDevice()).toBeUndefined();
  saveSlackSettings({ mode: "gateway", gatewayUrl: "https://gateway.test" }); expect(slackConfigured(readSlackSettings())).toBe(false);
});

it("quarantines corrupt local identity state without exposing its contents and permits re-linking", async () => {
  await registerGatewayDevice("https://gateway.test", undefined, registration());
  const file = path.join(gatewayStateRoot(), "gateway-device.json");
  fs.writeFileSync(file, "invalid-private-state");
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(readGatewayDevice()).toBeUndefined();
  expect(JSON.stringify(warning.mock.calls)).not.toContain("invalid-private-state");
  expect(fs.readdirSync(gatewayStateRoot()).some((entry) => entry.startsWith("gateway-device.json.corrupt-"))).toBe(true);
  await registerGatewayDevice("https://gateway.test", undefined, registration()); expect(readGatewayDevice()).toBeDefined();
});
