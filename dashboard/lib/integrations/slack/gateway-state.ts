import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { gatewayUrl, type GatewayBinding } from "@shared/slack-gateway/protocol";
import { readStateFile } from "./state-file";

const BindingSchema = z.object({ deviceId: z.string(), teamId: z.string().regex(/^T[A-Z0-9]+$/), userId: z.string().regex(/^[UW][A-Z0-9]+$/), userName: z.string().max(200), dmChannelId: z.string().regex(/^D[A-Z0-9]+$/) });
const DeviceSchema = z.object({
  url: z.string(), deviceId: z.string().uuid(), publicKey: z.string(), privateKey: z.string(),
  code: z.string().regex(/^[A-Z2-9]{8}$/), expiresAt: z.number(), binding: BindingSchema.optional(), confirmed: z.boolean().optional(), revoked: z.boolean().optional(),
});
export type SlackGatewayDevice = z.infer<typeof DeviceSchema>;

export function gatewayStateRoot(): string {
  return path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "devhub", "slack");
}

export function readGatewayDevice(root = gatewayStateRoot()): SlackGatewayDevice | undefined {
  return readStateFile<SlackGatewayDevice | undefined>(path.join(root, "gateway-device.json"), (value) => DeviceSchema.parse(value), () => undefined);
}

export function saveGatewayDevice(device: SlackGatewayDevice, root = gatewayStateRoot()): void {
  DeviceSchema.parse(device);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporary = path.join(root, `gateway-device.${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(device), { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, path.join(root, "gateway-device.json"));
}

export function gatewayPairingStatus(root = gatewayStateRoot()) {
  const device = readGatewayDevice(root);
  if (!device) return undefined;
  return { deviceId: device.deviceId, url: device.url, revoked: !!device.revoked,
    ...(device.binding && !device.revoked ? { binding: device.binding, pending: device.confirmed !== true } : {}),
    ...(!device.binding && !device.revoked ? { code: device.code, expiresAt: device.expiresAt } : {}) };
}

export async function registerGatewayDevice(url: string, root = gatewayStateRoot(), request: typeof fetch = fetch): Promise<void> {
  const endpoint = gatewayUrl(url);
  const existing = readGatewayDevice(root);
  if (existing?.binding && !existing.revoked && existing.url !== endpoint.origin) throw new Error("Unlink the existing Team Slack device before changing gateway.");
  if (existing && !existing.revoked && existing.url === endpoint.origin && (existing.binding || existing.expiresAt > Date.now())) return;
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const response = await request(new URL("/register", endpoint), {
    method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ publicKey, label: os.hostname().slice(0, 80) }),
  });
  if (!response.ok) throw new Error("The gateway couldn't register this device. Check the URL or try again later.");
  const registration = z.object({ deviceId: z.string().uuid(), code: z.string().regex(/^[A-Z2-9]{8}$/), expiresAt: z.number().min(Date.now()).max(Date.now() + 11 * 60_000) }).parse(await response.json());
  saveGatewayDevice({ url: endpoint.origin, ...registration, publicKey, privateKey }, root);
}

export function acceptGatewayBinding(deviceId: string, binding: GatewayBinding, root = gatewayStateRoot()): void {
  const device = readGatewayDevice(root);
  const parsed = BindingSchema.parse(binding);
  if (!device || device.revoked || device.deviceId !== deviceId || parsed.deviceId !== deviceId) throw new Error("Gateway device changed");
  if (device.binding && (device.binding.userId !== parsed.userId || device.binding.teamId !== parsed.teamId || device.binding.dmChannelId !== parsed.dmChannelId)) throw new Error("Gateway owner changed; link again in Setup.");
  saveGatewayDevice({ ...device, binding: parsed, revoked: false }, root);
}

export function confirmGatewayBinding(deviceId: string, userId: string, root = gatewayStateRoot()): void {
  const device = readGatewayDevice(root);
  if (!device || device.revoked || device.deviceId !== deviceId || device.binding?.userId !== userId) throw new Error("Gateway binding changed; check the member in Setup again.");
  saveGatewayDevice({ ...device, confirmed: true }, root);
}

export function revokeGatewayDevice(root = gatewayStateRoot()): void {
  const device = readGatewayDevice(root);
  if (device) saveGatewayDevice({ ...device, revoked: true }, root);
}
