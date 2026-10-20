import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/integrations/slack/runtime", () => ({ restartSlackBot: vi.fn(), slackStatus: vi.fn(() => ({ configured: true })), unlinkSlackGateway: vi.fn(async () => {}) }));
import { restartSlackBot, unlinkSlackGateway } from "@/lib/integrations/slack/runtime";
import { acceptGatewayBinding, gatewayPairingStatus } from "@/lib/integrations/slack/gateway-state";
import { readSlackSettings, SLACK_ENV_KEYS } from "@/lib/integrations/slack/settings";
import { POST } from "./route";

let root: string;
const origin = "http://localhost:1350";
function request(body: unknown, source = origin) {
  return new NextRequest(`${origin}/api/integrations/slack/gateway`, { method: "POST", headers: { host: "localhost:1350", origin: source, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "team-slack-api-"));
  vi.stubEnv("XDG_STATE_HOME", root); vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, ".env.local")); vi.stubEnv("DEVHUB_API_SECRET", "");
  for (const key of Object.values(SLACK_ENV_KEYS)) vi.stubEnv(key, "");
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ deviceId: randomUUID(), code: "ABCD2345", expiresAt: Date.now() + 600000 }), { status: 201 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });

it("registers one device in one click and switches the existing runtime under its lock", async () => {
  const response = await POST(request({ action: "connect", url: "https://gateway.test" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(gatewayPairingStatus()?.code).toBe("ABCD2345"); expect(readSlackSettings().mode).toBe("gateway");
  expect(restartSlackBot).toHaveBeenCalledTimes(1); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE KEY");
});
it("confirms exactly the pending device and member from Setup, in one click", async () => {
  await POST(request({ action: "connect", url: "https://gateway.test" }));
  const deviceId = gatewayPairingStatus()!.deviceId;
  acceptGatewayBinding(deviceId, { deviceId, teamId: "T1", userId: "U1", userName: "one", dmChannelId: "D1" });
  expect(gatewayPairingStatus()?.pending).toBe(true);
  expect((await POST(request({ action: "confirm", deviceId, userId: "U2" }))).status).toBe(502);
  expect(gatewayPairingStatus()?.pending).toBe(true);
  expect((await POST(request({ action: "confirm", deviceId, userId: "U1" }))).status).toBe(200);
  expect(gatewayPairingStatus()?.pending).toBe(false);
  expect(readSlackSettings().allowedUserId).toBe("U1");
});
it("unlinks a rejected pending member without needing a confirmation step", async () => {
  await POST(request({ action: "connect", url: "https://gateway.test" }));
  const deviceId = gatewayPairingStatus()!.deviceId;
  acceptGatewayBinding(deviceId, { deviceId, teamId: "T1", userId: "UWRONG", userName: "wrong", dmChannelId: "D1" });
  expect((await POST(request({ action: "unlink" }))).status).toBe(200);
  expect(unlinkSlackGateway).toHaveBeenCalledOnce(); expect(gatewayPairingStatus()?.revoked).toBe(true);
});
it.each(["", "https://evil.test"])("refuses cross-origin pairing requests: %s", async (source) => {
  expect((await POST(request({ action: "connect", url: "https://gateway.test" }, source))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects unsafe URLs and unknown fields before making a network request", async () => {
  expect((await POST(request({ action: "connect", url: "http://remote.test" }))).status).toBe(400);
  expect((await POST(request({ action: "connect", url: "https://gateway.test", userId: "UFORGED" }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("waits for revocation acknowledgement and does not claim success while offline", async () => {
  await POST(request({ action: "connect", url: "https://gateway.test" }));
  vi.mocked(unlinkSlackGateway).mockRejectedValueOnce(new Error("offline-private-detail"));
  const failed = await POST(request({ action: "unlink" }));
  expect(failed.status).toBe(502); expect(JSON.stringify(await failed.json())).not.toContain("private-detail");
  expect(gatewayPairingStatus()?.revoked).toBe(false);
  expect((await POST(request({ action: "unlink" }))).status).toBe(200); expect(gatewayPairingStatus()?.revoked).toBe(true);
});
