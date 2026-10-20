import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maskSlackSettings, readSlackSettings, saveSlackSettings, slackConfigured, slackSettingsRevision, SLACK_ENV_KEYS } from "./settings";
import { SlackSettingsSchema, SLACK_SECRET_MASK } from "./shared";

let root: string;
const settings = { botToken: "xoxb-fake-1", appToken: "xapp-private-app-token", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM", postNeedsYou: true, postProgress: true };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-settings-"));
  vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, ".env.local"));
  for (const key of Object.values(SLACK_ENV_KEYS)) vi.stubEnv(key, "");
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("Slack Setup settings", () => {
  it("persists to the managed env file and applies settings without a restart", () => {
    saveSlackSettings(settings);
    expect(readSlackSettings()).toEqual(settings);
    expect(process.env.SLACK_BOT_TOKEN).toBe(settings.botToken);
    expect(process.env.SLACK_APP_TOKEN).toBe(settings.appToken);
    expect(fs.readFileSync(path.join(root, ".env.local"), "utf8")).toContain("SLACK_CHANNEL_ID=CCHANNEL");
    expect(slackConfigured(readSlackSettings())).toBe(true);
  });
  it("masks both tokens completely without masking IDs", () => {
    expect(maskSlackSettings(settings)).toEqual({ ...settings, botToken: SLACK_SECRET_MASK, appToken: SLACK_SECRET_MASK });
    expect(JSON.stringify(maskSlackSettings(settings))).not.toMatch(/private|xoxb|xapp/);
    expect(maskSlackSettings({ ...settings, botToken: "", appToken: "" }).botToken).toBe("");
  });
  it("keeps saved tokens when blank or masked, and replaces only a new token", () => {
    saveSlackSettings(settings);
    saveSlackSettings({ botToken: "", appToken: SLACK_SECRET_MASK, channelId: "COTHER" });
    expect(readSlackSettings()).toEqual({ ...settings, channelId: "COTHER" });
    saveSlackSettings({ botToken: " xoxb-new " });
    expect(readSlackSettings().botToken).toBe("xoxb-new");
  });
  it("keeps tokens supplied by the environment when saving IDs", () => {
    vi.stubEnv("SLACK_BOT_TOKEN", settings.botToken);
    vi.stubEnv("SLACK_APP_TOKEN", settings.appToken);
    saveSlackSettings({ channelId: settings.channelId, allowedUserId: settings.allowedUserId });
    expect(slackConfigured(readSlackSettings())).toBe(true);
  });
  it("defaults Needs you posting on and persists an explicit opt-out without changing the tokens", () => {
    expect(readSlackSettings().postNeedsYou).toBe(true);
    saveSlackSettings(settings);
    saveSlackSettings({ postNeedsYou: false });
    expect(readSlackSettings()).toEqual({ ...settings, postNeedsYou: false });
    expect(process.env.SLACK_POST_NEEDS_YOU).toBe("0");
    saveSlackSettings({ channelId: "COTHER" });
    expect(readSlackSettings().postNeedsYou).toBe(false);
    saveSlackSettings({ postNeedsYou: true });
    expect(readSlackSettings().postNeedsYou).toBe(true);
    expect(SlackSettingsSchema.safeParse({ postNeedsYou: "true" }).success).toBe(false);
  });
  it("defaults agent progress posts on, persists an opt-out separately from Needs you, and rejects non-booleans", () => {
    expect(readSlackSettings().postProgress).toBe(true);
    saveSlackSettings(settings);
    saveSlackSettings({ postProgress: false });
    expect(readSlackSettings()).toEqual({ ...settings, postProgress: false });
    expect(process.env.SLACK_POST_PROGRESS).toBe("0");
    expect(readSlackSettings().postNeedsYou).toBe(true);
    saveSlackSettings({ channelId: "COTHER" });
    expect(readSlackSettings().postProgress).toBe(false);
    saveSlackSettings({ postProgress: true });
    expect(readSlackSettings().postProgress).toBe(true);
    expect(SlackSettingsSchema.safeParse({ postProgress: "false" }).success).toBe(false);
  });
  it("clears the optional workspace ID and disconnects explicitly", () => {
    saveSlackSettings(settings);
    saveSlackSettings({ teamId: "" });
    expect(readSlackSettings().teamId).toBe("");
    saveSlackSettings(null);
    expect(slackConfigured(readSlackSettings())).toBe(false);
    expect(process.env.SLACK_BOT_TOKEN).toBeUndefined();
    expect(fs.readFileSync(path.join(root, ".env.local"), "utf8")).not.toContain("SLACK_");
  });
  it.each([{ botToken: "xoxp-human" }, { appToken: "private\nOTHER=secret" }, { channelId: "#devhub" }, { allowedUserId: "bot" }, { teamId: "../../escape" }, { extra: "value" }])("rejects invalid settings before writing: %j", (input) => {
    expect(SlackSettingsSchema.safeParse(input).success).toBe(false);
    expect(() => saveSlackSettings(input)).toThrow();
    expect(fs.existsSync(path.join(root, ".env.local"))).toBe(false);
  });
  it("binds the revision to tokens and recipients, not their masks", () => {
    expect(slackSettingsRevision(settings)).toMatch(/^[a-f0-9]{64}$/);
    for (const field of Object.keys(settings) as Array<keyof typeof settings>) {
      expect(slackSettingsRevision({ ...settings, [field]: typeof settings[field] === "boolean" ? false : settings[field] + "X" })).not.toBe(slackSettingsRevision(settings));
    }
  });
  it.each(["botToken", "appToken", "channelId", "allowedUserId"])("requires %s before connecting", (field) => {
    expect(slackConfigured({ ...settings, [field]: "" })).toBe(false);
    expect(slackConfigured({ ...settings, botToken: SLACK_SECRET_MASK })).toBe(false);
  });
});
