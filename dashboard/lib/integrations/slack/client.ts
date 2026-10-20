import { SocketModeClient } from "@slack/socket-mode";
import { LogLevel, WebClient, type KnownBlock } from "@slack/web-api";
import type { ModalView } from "@slack/types";
import { z } from "zod";
import type { SlackConnectionState, SlackSettings } from "./shared";
import type { GatewayEnvelope } from "@shared/slack-gateway/protocol";

export interface SlackIdentity { userId: string; name: string; teamId: string }
export interface SlackEnvelope { envelopeId: string; type: string; body: unknown; acknowledge: () => Promise<void>; gateway?: { envelope: GatewayEnvelope; deviceId: string } }
/** The task a posted message is about, so a ✅ reaction on it can check the task off. Never sent to Slack. */
export interface SlackTaskRef { profile: string; taskId: string; date?: string; title: string }
export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: KnownBlock[];
  thread_ts?: string;
  reply_broadcast?: boolean;
  mrkdwn?: boolean;
  parse?: "none";
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  taskRef?: SlackTaskRef;
}

export interface SlackHomeView { type: "home"; blocks: KnownBlock[] }

export interface SlackReceipt { channel: string; ts: string }
export interface SlackMessageUpdate extends SlackMessage { ts: string }

export interface SlackTransport {
  authenticate: () => Promise<SlackIdentity>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  postMessage: (message: SlackMessage) => Promise<SlackReceipt>;
  updateMessage: (message: SlackMessageUpdate) => Promise<void>;
  /** Publishes the App Home tab for one user (views.publish). */
  publishHome: (userId: string, view: SlackHomeView) => Promise<void>;
  openModal?: (triggerId: string, view: ModalView) => Promise<void>;
  onEnvelope: (listener: (envelope: SlackEnvelope) => Promise<void>) => void;
  onState: (listener: (state: SlackConnectionState, error?: unknown) => void) => void;
  unlink?: () => Promise<void>;
}

export type SlackClient = SlackTransport;

const logger = {
  debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, setName() {},
  getLevel: () => LogLevel.ERROR,
};

/** A send that was stopped on our side before any request left (shutdown, a guard, pacing failed). */
export class SlackNotSentError extends Error {}

export type SlackFailure = { kind: "rate-limited"; retryAfterMs: number } | { kind: "not-sent" } | { kind: "uncertain" };

/** Network errors raised before a request could have reached Slack: DNS, refused or unreachable. */
const NOT_SENT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const MIN_RETRY_AFTER_MS = 1000;

function errorCodes(error: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 3) return;
    const record = value as { code?: unknown; original?: unknown; cause?: unknown };
    if (typeof record.code === "string") found.push(record.code);
    visit(record.original, depth + 1);
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  return found;
}

function retryAfterMs(seconds: unknown): number {
  const value = typeof seconds === "string" ? Number.parseInt(seconds, 10) : seconds;
  return Math.max(MIN_RETRY_AFTER_MS, typeof value === "number" && Number.isFinite(value) ? value * 1000 : MIN_RETRY_AFTER_MS);
}

/**
 * What a failed Slack call tells us about whether it may have been processed. Rate limits and
 * connection failures that happen before a request leaves are safe to retry; anything else (a
 * timeout, a reset, a Slack-side error) may have posted, so a non-idempotent send must not repeat.
 */
export function classifySlackFailure(error: unknown): SlackFailure {
  if (error instanceof SlackNotSentError) return { kind: "not-sent" };
  const record = (error ?? {}) as { code?: unknown; retryAfter?: unknown; statusCode?: unknown; headers?: Record<string, unknown>; data?: { error?: unknown; response_metadata?: { retryAfter?: unknown } } };
  if (record.code === "slack_webapi_rate_limited_error") return { kind: "rate-limited", retryAfterMs: retryAfterMs(record.retryAfter) };
  if (record.code === "slack_webapi_http_error" && record.statusCode === 429) return { kind: "rate-limited", retryAfterMs: retryAfterMs(record.headers?.["retry-after"]) };
  if (record.code === "slack_webapi_platform_error" && record.data?.error === "ratelimited") return { kind: "rate-limited", retryAfterMs: retryAfterMs(record.data.response_metadata?.retryAfter) };
  if (record.code === "slack_webapi_request_error" && errorCodes(error).some((code) => NOT_SENT_CODES.has(code))) return { kind: "not-sent" };
  return { kind: "uncertain" };
}

export interface SlackRetryOptions {
  /** Total tries, including the first. */
  attempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Longest single wait; a longer Retry-After gives up so one slow send can't hold the queue. */
  maxWaitMs?: number;
}

const sleepFor = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });

/** Retries with bounded backoff, waiting out Slack's Retry-After on a 429. The last error is rethrown, never swallowed. */
export async function withSlackRetry<Result>(send: () => Promise<Result>, options: SlackRetryOptions = {}): Promise<Result> {
  const { attempts = 4, sleep = sleepFor, maxWaitMs = 60_000 } = options;
  for (let attempt = 1; ; attempt++) {
    try { return await send(); }
    catch (error) {
      const failure = classifySlackFailure(error);
      if (attempt >= attempts || failure.kind === "uncertain") throw error;
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      if (failure.kind === "rate-limited" && failure.retryAfterMs > maxWaitMs) throw error;
      await sleep(failure.kind === "rate-limited" ? failure.retryAfterMs : backoff);
    }
  }
}

export function createSlackClient(settings: SlackSettings, options: { sleep?: (milliseconds: number) => Promise<void> } = {}): SlackClient {
  // Calls that are safe to repeat (auth.test, chat.update) let the SDK retry and wait out rate limits.
  // A post is not: the SDK would also repeat one whose outcome is unknown, so posts are retried here,
  // and only after a 429 or a failure that happened before anything was sent.
  const web = new WebClient(settings.botToken, { timeout: 10000, retryConfig: { retries: 3, factor: 2, minTimeout: 1000, maxTimeout: 10000 }, rejectRateLimitedCalls: false, logger });
  const poster = new WebClient(settings.botToken, { timeout: 10000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, logger });
  const socket = new SocketModeClient({ appToken: settings.appToken, autoReconnectEnabled: true, logger, clientOptions: { timeout: 10000 } });
  return {
    async authenticate() {
      const identity = await web.auth.test();
      if (!identity.ok || !identity.user_id || !identity.team_id) throw new Error("Invalid Slack identity");
      return { userId: identity.user_id, name: identity.user ?? "DevHub", teamId: identity.team_id };
    },
    async start() { await socket.start(); },
    async stop() { await socket.disconnect(); },
    async postMessage(message) {
      const payload = { ...message };
      delete payload.taskRef;
      const result = await withSlackRetry(() => poster.chat.postMessage(payload as Parameters<typeof poster.chat.postMessage>[0]), { sleep: options.sleep });
      if (!result.ok || !result.channel || !result.ts) throw new Error("Missing Slack message receipt");
      return { channel: result.channel, ts: result.ts };
    },
    async updateMessage(message) {
      const update = { ...message };
      delete update.taskRef;
      delete update.thread_ts;
      delete update.reply_broadcast;
      await web.chat.update(update);
    },
    async publishHome(userId, view) {
      await web.views.publish({ user_id: userId, view });
    },
    async openModal(triggerId, view) {
      await poster.views.open({ trigger_id: triggerId, view });
    },
    onEnvelope(listener) {
      socket.on("slack_event", (event: { envelope_id: string; type: string; body: unknown; ack: () => Promise<void> }) => {
        void listener({ envelopeId: event.envelope_id, type: event.type, body: event.body, acknowledge: event.ack });
      });
    },
    onState(listener) {
      for (const state of ["connecting", "connected", "reconnecting", "disconnected"] as const) socket.on(state, () => listener(state));
      socket.on("error", (error: unknown) => listener("error", error));
    },
  };
}

function slackErrorCode(error: unknown): string | undefined {
  const parsed = z.object({ code: z.string().optional(), data: z.object({ error: z.string().optional() }).optional() }).safeParse(error);
  return parsed.success ? parsed.data.data?.error ?? parsed.data.code : undefined;
}

/** Slack said the tokens or scopes are wrong: trying again won't help until Setup changes. */
export function slackConfigurationRejected(error: unknown): boolean {
  return ["invalid_auth", "not_authed", "token_revoked", "account_inactive", "missing_scope", "gateway_link_required"].includes(slackErrorCode(error) ?? "");
}

export function slackErrorMessage(error: unknown): string {
  const code = slackErrorCode(error);
  if (code === "gateway_link_required") return "Connect to team Slack again in Setup. This device's link is missing or revoked.";
  if (["invalid_auth", "not_authed", "token_revoked", "account_inactive"].includes(code ?? "")) return "Slack rejected the token. Check the tokens in Setup.";
  if (["not_in_channel", "channel_not_found"].includes(code ?? "")) return "Invite @DevHub to the configured channel and check its channel ID.";
  if (code === "missing_scope") return "Reinstall the Slack app with the permissions from Create Slack app.";
  if (["ratelimited", "slack_webapi_rate_limited_error"].includes(code ?? "")) return "Slack asked us to slow down. Wait before sending another message.";
  return "Could not connect to Slack. Check the tokens and your connection in Setup.";
}
