import { z } from "zod";
import { gatewayUrl, type GatewayBinding } from "@shared/slack-gateway/protocol";

export const SLACK_SECRET_MASK = "••••••••";

export interface SlackSettings {
  mode?: "direct" | "gateway";
  gatewayUrl?: string;
  deviceId?: string;
  botToken: string;
  appToken: string;
  channelId: string;
  allowedUserId: string;
  teamId: string;
  postNeedsYou?: boolean;
  /** Agent milestones (plan ready, PR opened, failed, needs input) in the task's thread. Default on. */
  postProgress?: boolean;
}

function token(prefix: string) {
  return z.string().trim().max(500).refine(
    (value) => !value || value === SLACK_SECRET_MASK || new RegExp(`^${prefix}-[A-Za-z0-9-]+$`).test(value),
    `Use a ${prefix}- token from the Slack app settings.`,
  ).optional();
}

function identifier(pattern: RegExp, message: string) {
  return z.string().trim().max(64).refine((value) => !value || pattern.test(value), message).optional();
}

export const SlackSettingsSchema = z.object({
  mode: z.enum(["direct", "gateway"]).optional(),
  gatewayUrl: z.string().trim().max(2048).refine((value) => { try { if (value) gatewayUrl(value); return true; } catch { return false; } }, "Use an HTTPS gateway URL (HTTP is only allowed on localhost).").optional(),
  botToken: token("xoxb"),
  appToken: token("xapp"),
  channelId: identifier(/^[CGD][A-Z0-9]+$/, "Use the channel ID, not its name."),
  allowedUserId: identifier(/^[UW][A-Z0-9]+$/, "Use your Slack member ID, not the bot's ID."),
  teamId: identifier(/^T[A-Z0-9]+$/, "Use the Slack workspace ID, or leave it blank."),
  postNeedsYou: z.boolean().optional(),
  postProgress: z.boolean().optional(),
}).strict();

export type SlackSettingsInput = z.infer<typeof SlackSettingsSchema>;
export type SlackConnectionState = "not-configured" | "disabled" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export interface SlackConnectionStatus {
  state: SlackConnectionState;
  message: string;
  botUserId?: string;
  botName?: string;
  teamId?: string;
}

export interface SlackStatus {
  configured: boolean;
  settings: SlackSettings;
  revision: string;
  connection: SlackConnectionStatus;
  profile: string;
  gateway?: { deviceId: string; url: string; code?: string; expiresAt?: number; binding?: GatewayBinding; pending?: boolean; revoked: boolean };
}

export interface SlackDelivery {
  state: "sending" | "sent" | "failed" | "unknown";
  detail: string;
}

export const SlackTestSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
}).strict();
