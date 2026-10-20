import { createHash } from "node:crypto";
import {
  readDashboardEnvLocalFile,
  resolveEnvValue,
  syncSlackProcessEnvFromOverrides,
  writeDashboardEnvLocalFile,
} from "@/lib/dashboard-env-local";
import { SlackSettingsSchema, SLACK_SECRET_MASK, type SlackSettings, type SlackSettingsInput } from "./shared";
import { readGatewayDevice } from "./gateway-state";

export const SLACK_ENV_KEYS = {
  mode: "SLACK_TRANSPORT",
  gatewayUrl: "SLACK_GATEWAY_URL",
  botToken: "SLACK_BOT_TOKEN",
  appToken: "SLACK_APP_TOKEN",
  channelId: "SLACK_CHANNEL_ID",
  allowedUserId: "SLACK_ALLOWED_USER_ID",
  teamId: "SLACK_TEAM_ID",
  postNeedsYou: "SLACK_POST_NEEDS_YOU",
  postProgress: "SLACK_POST_PROGRESS",
} as const;

const CREDENTIAL_FIELDS = ["botToken", "appToken", "channelId", "allowedUserId", "teamId"] as const;

export function readSlackSettings(overrides = readDashboardEnvLocalFile().overrides): SlackSettings {
  const mode = resolveEnvValue(SLACK_ENV_KEYS.mode, overrides);
  const url = resolveEnvValue(SLACK_ENV_KEYS.gatewayUrl, overrides);
  const device = mode === "gateway" ? readGatewayDevice() : undefined;
  const binding = device && device.confirmed && !device.revoked && device.url === url ? device.binding : undefined;
  return {
    ...(mode === "gateway" || mode === "direct" ? { mode } : {}),
    ...(url ? { gatewayUrl: url } : {}),
    botToken: resolveEnvValue(SLACK_ENV_KEYS.botToken, overrides) ?? "",
    appToken: resolveEnvValue(SLACK_ENV_KEYS.appToken, overrides) ?? "",
    channelId: resolveEnvValue(SLACK_ENV_KEYS.channelId, overrides) ?? "",
    allowedUserId: resolveEnvValue(SLACK_ENV_KEYS.allowedUserId, overrides) ?? "",
    teamId: resolveEnvValue(SLACK_ENV_KEYS.teamId, overrides) ?? "",
    postNeedsYou: resolveEnvValue(SLACK_ENV_KEYS.postNeedsYou, overrides) !== "0",
    postProgress: resolveEnvValue(SLACK_ENV_KEYS.postProgress, overrides) !== "0",
    ...(mode === "gateway" ? { allowedUserId: binding?.userId ?? "", teamId: binding?.teamId ?? "", channelId: binding?.dmChannelId ?? "", ...(device ? { deviceId: device.deviceId } : {}) } : {}),
  };
}

export function slackConfigured(settings: SlackSettings): boolean {
  if (settings.mode === "gateway") {
    const device = readGatewayDevice();
    return !!(settings.gatewayUrl && device && !device.revoked && device.url === settings.gatewayUrl && (device.binding || device.expiresAt > Date.now()));
  }
  const input = { ...settings };
  delete input.deviceId;
  const parsed = SlackSettingsSchema.safeParse(input);
  return parsed.success && !!(settings.botToken && settings.appToken && settings.channelId && settings.allowedUserId)
    && settings.botToken !== SLACK_SECRET_MASK && settings.appToken !== SLACK_SECRET_MASK;
}

export function maskSlackSettings(settings: SlackSettings): SlackSettings {
  return { ...settings, botToken: settings.botToken ? SLACK_SECRET_MASK : "", appToken: settings.appToken ? SLACK_SECRET_MASK : "" };
}

export function slackSettingsRevision(settings: SlackSettings): string {
  const value = settings.mode === "gateway" ? { ...settings, allowedUserId: "", teamId: "", channelId: "" } : settings;
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function applySlackSettings(overrides: Map<string, string>, input: SlackSettingsInput | null): void {
  if (input === null) {
    for (const key of Object.values(SLACK_ENV_KEYS)) overrides.delete(key);
    return;
  }
  const update = SlackSettingsSchema.parse(input);
  if (update.mode !== undefined) overrides.set(SLACK_ENV_KEYS.mode, update.mode);
  if (update.gatewayUrl !== undefined) overrides.set(SLACK_ENV_KEYS.gatewayUrl, update.gatewayUrl ? new URL(update.gatewayUrl.replace(/^ws/, "http")).origin : "");
  for (const field of CREDENTIAL_FIELDS) {
    const value = update[field];
    const secret = field === "botToken" || field === "appToken";
    const next = value === undefined || (secret && (!value || value === SLACK_SECRET_MASK)) ? resolveEnvValue(SLACK_ENV_KEYS[field], overrides) ?? "" : value;
    if (next) overrides.set(SLACK_ENV_KEYS[field], next);
    else overrides.delete(SLACK_ENV_KEYS[field]);
  }
  if (update.postNeedsYou !== undefined) overrides.set(SLACK_ENV_KEYS.postNeedsYou, update.postNeedsYou ? "1" : "0");
  if (update.postProgress !== undefined) overrides.set(SLACK_ENV_KEYS.postProgress, update.postProgress ? "1" : "0");
}

export function saveSlackSettings(input: SlackSettingsInput | null): void {
  const { overrides, passthrough } = readDashboardEnvLocalFile();
  applySlackSettings(overrides, input);
  writeDashboardEnvLocalFile(overrides, passthrough);
  syncSlackProcessEnvFromOverrides(overrides);
}
