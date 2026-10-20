import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./runtime", () => ({ sendGatewaySlackTest: vi.fn(async () => ({ channel: "D1", ts: "1.000" })) }));
import { sendGatewaySlackTest } from "./runtime";
import { sendSlackTest } from "./test-message";
import { readSlackSettings, saveSlackSettings, slackSettingsRevision, SLACK_ENV_KEYS } from "./settings";
import { acceptGatewayBinding, confirmGatewayBinding, readGatewayDevice, registerGatewayDevice } from "./gateway-state";
import { SlackNotSentError } from "./client";

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-gateway-test-post-"));
  vi.stubEnv("XDG_STATE_HOME", root); vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, ".env.local"));
  for (const key of Object.values(SLACK_ENV_KEYS)) vi.stubEnv(key, "");
  vi.clearAllMocks();
  await registerGatewayDevice("https://gateway.test", undefined, vi.fn(async () => new Response(JSON.stringify({ deviceId: randomUUID(), code: "ABCD2345", expiresAt: Date.now() + 600000 }), { status: 201 })));
  const device = readGatewayDevice()!; acceptGatewayBinding(device.deviceId, { deviceId: device.deviceId, userId: "U1", teamId: "T1", userName: "one", dmChannelId: "D1" });
  confirmGatewayBinding(device.deviceId, "U1");
  saveSlackSettings({ mode: "gateway", gatewayUrl: "https://gateway.test" });
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it("uses the existing lock-owning device transport for tests and preserves request idempotency", async () => {
  const settings = readSlackSettings(); const request = { revision: slackSettingsRevision(settings), requestId: randomUUID() };
  expect(await sendSlackTest(request, { root, settings, profile: "work" })).toMatchObject({ state: "sent" });
  expect(await sendSlackTest(request, { root, settings, profile: "work" })).toMatchObject({ state: "sent" });
  expect(sendGatewaySlackTest).toHaveBeenCalledTimes(1); expect(sendGatewaySlackTest).toHaveBeenCalledWith(expect.objectContaining({ channel: "D1" }));
});
it("distinguishes an offline device from an unknown delivery without resending", async () => {
  const settings = readSlackSettings(); const request = { revision: slackSettingsRevision(settings), requestId: randomUUID() };
  vi.mocked(sendGatewaySlackTest).mockRejectedValueOnce(new SlackNotSentError("offline"));
  expect(await sendSlackTest(request, { root, settings, profile: "work" })).toMatchObject({ state: "failed" });
  vi.mocked(sendGatewaySlackTest).mockRejectedValueOnce(new Error("private-request"));
  const unknown = { ...request, requestId: randomUUID() };
  expect(await sendSlackTest(unknown, { root, settings, profile: "work" })).toMatchObject({ state: "unknown" });
  await sendSlackTest(unknown, { root, settings, profile: "work" }); expect(sendGatewaySlackTest).toHaveBeenCalledTimes(2);
});
