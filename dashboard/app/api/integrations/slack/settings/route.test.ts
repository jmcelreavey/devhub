import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/integrations/slack/runtime", () => ({ restartSlackBot: vi.fn(), slackStatus: vi.fn() }));
import { restartSlackBot, slackStatus } from "@/lib/integrations/slack/runtime";
import { maskSlackSettings, readSlackSettings, slackConfigured, slackSettingsRevision, SLACK_ENV_KEYS } from "@/lib/integrations/slack/settings";
import { POST } from "./route";

const origin = "http://localhost:1350";
const settings = { botToken: "xoxb-fake", appToken: "xapp-private-app", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM", postNeedsYou: true, postProgress: true };
let root: string;
function request(body: unknown, source = origin) {
  return new NextRequest(origin + "/api/integrations/slack/settings", { method: "POST", headers: { host: "localhost:1350", ...(source ? { origin: source } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-settings-route-"));
  vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, ".env.local"));
  vi.stubEnv("DEVHUB_API_SECRET", "");
  for (const key of Object.values(SLACK_ENV_KEYS)) vi.stubEnv(key, "");
  vi.clearAllMocks();
  vi.mocked(slackStatus).mockImplementation(() => {
    const current = readSlackSettings();
    return { configured: slackConfigured(current), settings: maskSlackSettings(current), revision: slackSettingsRevision(current), profile: "work", connection: { state: "connecting", message: "Connecting to Slack…" } };
  });
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("POST Slack settings", () => {
  it("saves the managed settings, masks both tokens and requests a live restart", async () => {
    const response = await POST(request(settings));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.settings).toEqual({ ...settings, botToken: "••••••••", appToken: "••••••••" });
    expect(JSON.stringify(data)).not.toMatch(/private-bot|private-app/);
    expect(readSlackSettings()).toEqual(settings);
    expect(restartSlackBot).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("keeps blank/masked tokens on save, and supports explicit disconnect", async () => {
    await POST(request(settings));
    await POST(request({ botToken: "", appToken: "••••••••", channelId: "COTHER" }));
    expect(readSlackSettings()).toEqual({ ...settings, channelId: "COTHER" });
    await POST(request(null));
    expect(readSlackSettings().botToken).toBe("");
    expect(readSlackSettings().channelId).toBe("");
  });
  it("saves only the posting preference without changing credentials", async () => {
    await POST(request(settings));
    const response = await POST(request({ postNeedsYou: false }));
    expect(response.status).toBe(200);
    expect(readSlackSettings()).toEqual({ ...settings, postNeedsYou: false });
    expect((await response.json()).settings.postNeedsYou).toBe(false);
    expect(process.env.SLACK_POST_NEEDS_YOU).toBe("0");
    expect(restartSlackBot).toHaveBeenCalledTimes(2);
  });
  it.each(["", "https://other.test"])("requires a same-origin, authenticated settings request: %s", async (source) => {
    expect((await POST(request(settings, source))).status).toBe(403);
    expect(restartSlackBot).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, ".env.local"))).toBe(false);
  });
  it("saves progress independently with the same authenticated settings path", async () => {
    await POST(request(settings));
    const response = await POST(request({ postProgress: false }));
    expect(response.status).toBe(200);
    expect(readSlackSettings()).toEqual({ ...settings, postProgress: false });
    expect((await response.json()).settings.postProgress).toBe(false);
    expect(process.env.SLACK_POST_PROGRESS).toBe("0");
  });
  it.each([{ botToken: "xoxp-person" }, { channelId: "#devhub" }, { allowedUserId: "../../user" }, { ...settings, webhook: "https://evil.test" }])("rejects invalid/extra fields before saving", async (input) => {
    expect((await POST(request(input))).status).toBe(400);
    expect(restartSlackBot).not.toHaveBeenCalled();
  });
  it("does not expose a filesystem error or a submitted token", async () => {
    vi.stubEnv("DEVHUB_ENV_FILE", root);
    const response = await POST(request(settings));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/private-bot|private-app|EISDIR/);
  });
});
