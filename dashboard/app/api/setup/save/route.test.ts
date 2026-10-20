import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { restartSlackBot } from "@/lib/integrations/slack/runtime";
import { readSlackSettings, SLACK_ENV_KEYS } from "@/lib/integrations/slack/settings";

vi.mock("@/lib/integrations/slack/runtime", () => ({ restartSlackBot: vi.fn() }));

const originalEnvFile = process.env.DEVHUB_ENV_FILE;
const originalMirror = process.env.DEVHUB_MIRROR_ENV_FILE;

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-setup-save-"));
  process.env.DEVHUB_ENV_FILE = path.join(tmp, ".env.local");
  process.env.DEVHUB_MIRROR_ENV_FILE = path.join(tmp, "packaged.env");
  fs.writeFileSync(
    process.env.DEVHUB_ENV_FILE,
    [
      "JIRA_DOMAIN=example.atlassian.net",
      "JIRA_EMAIL=dev@example.com",
      "JIRA_API_TOKEN=dead-token",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    process.env.DEVHUB_MIRROR_ENV_FILE,
    [
      "NOTES_DIR=/tmp/notes",
      "JIRA_DOMAIN=example.atlassian.net",
      "JIRA_EMAIL=dev@example.com",
      "JIRA_API_TOKEN=dead-token",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalEnvFile === undefined) delete process.env.DEVHUB_ENV_FILE;
  else process.env.DEVHUB_ENV_FILE = originalEnvFile;
  if (originalMirror === undefined) delete process.env.DEVHUB_MIRROR_ENV_FILE;
  else process.env.DEVHUB_MIRROR_ENV_FILE = originalMirror;
});

const { POST } = await import("./route");

function request(body: unknown): NextRequest {
  return new NextRequest("http://test/api/setup/save", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/setup/save jira", () => {
  it("persists a replacement API token when Jira is already configured", async () => {
    const res = await POST(
      request({
        jira: {
          domain: "example.atlassian.net",
          email: "dev@example.com",
          apiToken: "replacement-token",
        },
      }),
    );
    expect(res.status).toBe(200);
    const primary = fs.readFileSync(process.env.DEVHUB_ENV_FILE!, "utf8");
    expect(primary).toContain("JIRA_API_TOKEN=replacement-token");
    expect(primary).not.toContain("dead-token");
    const mirrored = fs.readFileSync(process.env.DEVHUB_MIRROR_ENV_FILE!, "utf8");
    expect(mirrored).toContain("JIRA_API_TOKEN=replacement-token");
    expect(mirrored).toContain("NOTES_DIR=/tmp/notes");
  });

  it("copies the Jira domain onto the browser-visible env key", async () => {
    const res = await POST(
      request({
        jira: {
          domain: "acme.atlassian.net",
          email: "dev@example.com",
          apiToken: "replacement-token",
        },
      }),
    );
    expect(res.status).toBe(200);
    const primary = fs.readFileSync(process.env.DEVHUB_ENV_FILE!, "utf8");
    expect(primary).toContain("JIRA_DOMAIN=acme.atlassian.net");
    expect(primary).toContain("NEXT_PUBLIC_JIRA_DOMAIN=acme.atlassian.net");
    const mirrored = fs.readFileSync(process.env.DEVHUB_MIRROR_ENV_FILE!, "utf8");
    expect(mirrored).toContain("NEXT_PUBLIC_JIRA_DOMAIN=acme.atlassian.net");
  });
});

describe("POST /api/setup/save typesafe", () => {
  const originalKey = process.env.TYPESAFE_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  });

  it("stores the Jev key with the other Setup keys, masked in the reply and live without a restart", async () => {
    const res = await POST(request({ typesafe: { apiKey: " apikey_0123456789abcdef " } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("apikey_0123456789abcdef");
    expect(body.saved).toContain("TYPESAFE_API_KEY=apik****cdef");
    const primary = fs.readFileSync(process.env.DEVHUB_ENV_FILE!, "utf8");
    expect(primary).toContain("TYPESAFE_API_KEY=apikey_0123456789abcdef");
    expect(primary).toContain("JIRA_API_TOKEN=dead-token");
    expect(process.env.TYPESAFE_API_KEY).toBe("apikey_0123456789abcdef");
  });

  it("removes the saved key when asked", async () => {
    await POST(request({ typesafe: { apiKey: "apikey_0123456789abcdef" } }));
    await POST(request({ typesafe: null }));
    expect(fs.readFileSync(process.env.DEVHUB_ENV_FILE!, "utf8")).not.toContain("TYPESAFE_API_KEY");
    expect(process.env.TYPESAFE_API_KEY).toBeUndefined();
  });
});

describe("POST /api/setup/save slack", () => {
  const settings = { botToken: "xoxb-fake", appToken: "xapp-private-app", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM", postNeedsYou: true, postProgress: true };
  beforeEach(() => { vi.clearAllMocks(); for (const key of Object.values(SLACK_ENV_KEYS)) vi.stubEnv(key, ""); vi.stubEnv("DEVHUB_API_SECRET", ""); });
  afterEach(() => vi.unstubAllEnvs());
  function slackRequest(slack: unknown) {
    return new NextRequest("http://localhost:1350/api/setup/save", { method: "POST", headers: { host: "localhost:1350", origin: "http://localhost:1350", "Content-Type": "application/json" }, body: JSON.stringify({ slack }) });
  }
  it("uses the same managed Slack settings and never returns either token", async () => {
    const response = await POST(slackRequest(settings));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toMatch(/private-bot|private-app/);
    expect(readSlackSettings()).toEqual(settings);
    expect(process.env.SLACK_BOT_TOKEN).toBe(settings.botToken);
    expect(restartSlackBot).toHaveBeenCalledTimes(1);
  });
  it("keeps masked secrets and removes the saved connection explicitly", async () => {
    await POST(slackRequest(settings));
    await POST(slackRequest({ botToken: "••••••••", appToken: "", teamId: "" }));
    expect(readSlackSettings()).toEqual({ ...settings, teamId: "" });
    await POST(slackRequest(null));
    expect(readSlackSettings().botToken).toBe("");
    expect(process.env.SLACK_APP_TOKEN).toBeUndefined();
  });
  it("requires the dashboard origin for Slack saves without changing older setup payloads", async () => {
    expect((await POST(request({ slack: settings }))).status).toBe(403);
    expect((await POST(slackRequest({ botToken: "xoxp-human" }))).status).toBe(400);
    expect(restartSlackBot).not.toHaveBeenCalled();
  });
});
