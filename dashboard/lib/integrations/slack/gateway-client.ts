import { randomUUID, sign } from "node:crypto";
import WebSocket from "ws";
import { eventAudience, gatewaySocketUrl, HANDOFF_DECLINE_ACTION, HANDOFF_PICKUP_ACTION, record, validGatewayId, validOperation, validSlackUser, type GatewayBinding, type GatewayEnvelope, type GatewayHandoffStatus, type GatewayMember, type GatewayOperation, type GatewayResult, type GatewayServerMessage } from "@shared/slack-gateway/protocol";
import { classifySlackFailure, SlackNotSentError, withSlackRetry, type SlackEnvelope, type SlackIdentity, type SlackReceipt, type SlackTransport, type SlackRetryOptions } from "./client";
import type { SlackConnectionState, SlackSettings } from "./shared";
import { acceptGatewayBinding, readGatewayDevice, revokeGatewayDevice, type SlackGatewayDevice } from "./gateway-state";
import { slackTransportContext } from "./transport-context";

interface Pending { operation: GatewayOperation; resolve: (result: GatewayResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export interface GatewayClientOptions { root?: string; socket?: (url: string) => WebSocket; reconnectMs?: number; random?: () => number; retry?: SlackRetryOptions }
export interface GatewayClient extends SlackTransport {
  listMembers(): Promise<GatewayMember[]>;
  askTeammate(input: Omit<Extract<GatewayOperation, { kind: "askTeammate" }>, "kind">): Promise<SlackReceipt>;
  handoff(input: Omit<Extract<GatewayOperation, { kind: "handoff" }>, "kind">): Promise<SlackReceipt>;
  handoffResolve(handoffId: string, outcome: "accepted" | "failed"): Promise<void>;
  handoffStatus(handoffIds: string[]): Promise<GatewayHandoffStatus[]>;
}

function validEnvelope(value: unknown, binding: GatewayBinding, botUserId: string, now = Date.now()): value is GatewayEnvelope {
  const envelope = record(value);
  if (typeof envelope.kind !== "string" || typeof envelope.id !== "string" || !envelope.id || envelope.id.length > 200 || envelope.teamId !== binding.teamId || envelope.userId !== binding.userId
    || typeof envelope.deadline !== "number" || !Number.isSafeInteger(envelope.deadline) || envelope.deadline <= now || envelope.deadline > now + 180_000
    || (envelope.channelId !== undefined && (typeof envelope.channelId !== "string" || !/^[CDG][A-Z0-9]+$/.test(envelope.channelId)))
    || (envelope.threadTs !== undefined && (typeof envelope.threadTs !== "string" || !/^\d+\.\d+$/.test(envelope.threadTs)))) return false;
  if (envelope.kind === "helper_reply") {
    const helper = record(envelope.helper); const ask = record(envelope.ask); const body = record(envelope.payload); const event = record(body.event);
    const audience = eventAudience(body);
    return validSlackUser(helper.userId) && helper.userId !== binding.userId && helper.userId !== botUserId && typeof helper.name === "string" && helper.name.length <= 200
      && validGatewayId(ask.askId) && typeof ask.channel === "string" && /^[CG][A-Z0-9]+$/.test(ask.channel) && ask.channel === envelope.channelId
      && typeof ask.threadTs === "string" && /^\d+\.\d+$/.test(ask.threadTs) && ask.threadTs === envelope.threadTs
      && !!audience && audience.kind === "message" && audience.teamId === binding.teamId && audience.userId === helper.userId
      && audience.channelId === ask.channel && ((audience.threadTs === ask.threadTs && event.thread_ts === ask.threadTs) || (ask.channel.startsWith("G") && audience.threadTs === event.ts && event.thread_ts === undefined))
      && typeof event.text === "string" && event.text.length <= 40000 && typeof event.ts === "string" && /^\d+\.\d+$/.test(event.ts)
      && (event.team === undefined || event.team === binding.teamId) && envelope.handoff === undefined && envelope.handoffId === undefined && envelope.status === undefined && envelope.byUserId === undefined;
  }
  if (envelope.helper !== undefined || envelope.ask !== undefined) return false;
  if (envelope.kind === "handoff_result") {
    const payload = record(envelope.payload);
    return validGatewayId(envelope.handoffId) && typeof envelope.status === "string" && ["accepted", "declined", "expired"].includes(envelope.status)
      && validSlackUser(envelope.byUserId) && envelope.byUserId !== binding.userId && envelope.byUserId !== botUserId
      && payload.handoffId === envelope.handoffId && payload.status === envelope.status && payload.byUserId === envelope.byUserId
      && envelope.channelId === undefined && envelope.threadTs === undefined && envelope.handoff === undefined;
  }
  if (envelope.handoffId !== undefined || envelope.status !== undefined || envelope.byUserId !== undefined) return false;
  if (envelope.handoff !== undefined) {
    const handoff = record(envelope.handoff); const audience = eventAudience(envelope.payload);
    const body = record(envelope.payload); const actions = Array.isArray(body.actions) ? body.actions.map(record) : [];
    if (envelope.kind !== "block_actions" || !validGatewayId(handoff.handoffId) || !validSlackUser(handoff.fromUserId) || handoff.fromUserId === binding.userId
      || handoff.fromUserId === botUserId || typeof handoff.fromName !== "string" || handoff.fromName.length > 200 || !audience
      || audience.userId !== binding.userId || audience.teamId !== binding.teamId || audience.kind !== envelope.kind
      || audience.channelId !== binding.dmChannelId || audience.channelId !== envelope.channelId || audience.threadTs !== envelope.threadTs
      || actions.length !== 1 || actions[0].type !== "button" || ![HANDOFF_PICKUP_ACTION, HANDOFF_DECLINE_ACTION].includes(String(actions[0].action_id))
      || (actions[0].value !== undefined && (typeof actions[0].value !== "string" || actions[0].value.length > 1900))) return false;
  }
  return ["message", "block_actions", "view_submission", "view_closed", "app_home_opened", "reaction_added"].includes(String(envelope.kind));
}

function validResult(value: GatewayResult, operation: GatewayOperation, binding: GatewayBinding): boolean {
  if (typeof value.ok !== "boolean" || (value.retryAfter !== undefined && (typeof value.retryAfter !== "number" || !Number.isFinite(value.retryAfter) || value.retryAfter <= 0))
    || (value.notSent !== undefined && typeof value.notSent !== "boolean")) return false;
  const receipt = record(value.receipt);
  if (value.receipt !== undefined && (typeof receipt.channel !== "string" || !/^[CDG][A-Z0-9]+$/.test(receipt.channel) || typeof receipt.ts !== "string" || !/^\d+\.\d+$/.test(receipt.ts))) return false;
  if (value.members !== undefined && (operation.kind !== "listMembers" || !Array.isArray(value.members)
    || !value.members.every((member) => { const entry = record(member); return validSlackUser(entry.userId) && entry.userId !== binding.userId && typeof entry.userName === "string" && entry.userName.length <= 200 && Object.keys(entry).every((key) => ["userId", "userName"].includes(key)); })
    || new Set(value.members.map((member) => member.userId)).size !== value.members.length)) return false;
  if (value.handoffs !== undefined && (operation.kind !== "handoffStatus" || !Array.isArray(value.handoffs) || value.handoffs.length !== operation.handoffIds.length
    || !value.handoffs.every((entry) => { const status = record(entry); return validGatewayId(status.handoffId) && operation.handoffIds.includes(status.handoffId)
      && typeof status.status === "string" && ["pending", "accepted", "declined", "expired", "unknown"].includes(status.status)
      && (status.byUserId === undefined || (status.status !== "unknown" && validSlackUser(status.byUserId)))
      && Object.keys(status).every((key) => ["handoffId", "status", "byUserId"].includes(key)); })
    || new Set(value.handoffs.map((entry) => entry.handoffId)).size !== value.handoffs.length)) return false;
  return !value.ok || ((operation.kind !== "listMembers" || value.members !== undefined) && (operation.kind !== "handoffStatus" || value.handoffs !== undefined));
}

export function gatewayReconnectDelay(base: number, random = Math.random): number {
  return Math.round(base * (0.75 + random() * 0.5));
}

export function createGatewayClient(settings: SlackSettings, options: GatewayClientOptions = {}): GatewayClient {
  let socket: WebSocket | undefined;
  let device: SlackGatewayDevice | undefined;
  let stopped = false;
  let linked = false;
  let identity: SlackIdentity | undefined;
  let envelopeListener: ((envelope: SlackEnvelope) => Promise<void>) | undefined;
  let stateListener: ((state: SlackConnectionState) => void) | undefined;
  let authenticating: Promise<SlackIdentity> | undefined;
  let resolveAuth: ((identity: SlackIdentity) => void) | undefined;
  let rejectAuth: ((error: Error) => void) | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unlinkResolve: (() => void) | undefined;
  let unlinkReject: ((error: Error) => void) | undefined;
  let unlinkTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, Pending>();

  function failPending() {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Gateway delivery outcome unknown")); }
    pending.clear();
  }

  function send(value: unknown): void {
    if (socket?.readyState !== WebSocket.OPEN) throw new SlackNotSentError("Team Slack is offline");
    socket.send(JSON.stringify(value));
  }

  function activateBinding(): void {
    const current = readGatewayDevice(options.root);
    if (!identity || !current?.confirmed || current.revoked || current.deviceId !== device?.deviceId || !current.binding) return;
    device = current;
    settings.allowedUserId = current.binding.userId;
    settings.teamId = current.binding.teamId;
    settings.channelId = current.binding.dmChannelId;
    settings.deviceId = current.deviceId;
    linked = true;
    resolveAuth?.(identity); resolveAuth = undefined; rejectAuth = undefined;
    stateListener?.("connected");
  }

  async function incoming(value: GatewayServerMessage): Promise<void> {
    if (stopped || !device) return;
    if (value.type === "challenge") {
      if (!/^[a-f0-9]{64}$/.test(value.nonce)) throw new Error("Invalid gateway challenge");
      const timestamp = Date.now();
      const signature = sign(null, Buffer.from(`${value.nonce}|${device.deviceId}|${timestamp}`), device.privateKey).toString("base64");
      send({ type: "auth", deviceId: device.deviceId, timestamp, signature, capabilities: ["ask", "handoff"] });
      return;
    }
    if (value.type === "awaiting_link") {
      clearTimeout(handshake);
      handshake = setTimeout(() => socket?.close(1000), Math.max(1, device.expiresAt - Date.now()));
      handshake.unref();
      stateListener?.("connecting"); return;
    }
    if (value.type === "revoked") {
      revokeGatewayDevice(options.root); stopped = true; linked = false; clearTimeout(reconnect);
      clearTimeout(unlinkTimer); unlinkResolve?.(); unlinkResolve = undefined; unlinkReject = undefined;
      rejectAuth?.(Object.assign(new Error("Team Slack link revoked"), { code: "gateway_link_required" })); socket?.close(); stateListener?.("disconnected"); return;
    }
    if (value.type === "linked") {
      if (value.identity.teamId !== value.binding.teamId || value.identity.userId === value.binding.userId) throw new Error("Invalid gateway identity");
      acceptGatewayBinding(device.deviceId, value.binding, options.root);
      device = readGatewayDevice(options.root)!;
      identity = value.identity;
      clearTimeout(handshake);
      if (device.confirmed) activateBinding();
      else stateListener?.("connecting");
      return;
    }
    if (value.type === "result") {
      const request = pending.get(value.requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(value.requestId);
      if (!device.binding || !validResult(value, request.operation, device.binding)) { request.reject(new Error("Invalid gateway result")); return; }
      if (value.ok) request.resolve(value);
      else if (typeof value.retryAfter === "number") request.reject(Object.assign(new Error("Slack asked the gateway to slow down"), { code: "slack_webapi_rate_limited_error", retryAfter: value.retryAfter }));
      else request.reject(value.notSent ? new SlackNotSentError("Gateway refused the Slack operation") : new Error("Gateway delivery outcome unknown"));
      return;
    }
    if (value.type === "event" && linked) {
      if (!device.binding || !identity || !validEnvelope(value.envelope, device.binding, identity.userId)) return;
      const envelope: GatewayEnvelope = value.envelope;
      await slackTransportContext.run({ deviceId: device.deviceId, eventId: envelope.id }, async () => envelopeListener?.({
        envelopeId: envelope.id, type: ["block_actions", "view_submission", "view_closed"].includes(envelope.kind) ? "interactive" : "events_api",
        body: envelope.payload, acknowledge: async () => {}, gateway: { envelope, deviceId: device!.deviceId },
      }));
    }
  }

  function connect(): void {
    if (stopped) return;
    linked = false;
    stateListener?.(identity ? "reconnecting" : "connecting");
    socket = (options.socket ?? ((url) => new WebSocket(url, { maxPayload: 256 * 1024, handshakeTimeout: 10_000, followRedirects: false })))(gatewaySocketUrl(settings.gatewayUrl ?? ""));
    const active = socket;
    let alive = true;
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (!alive) { active.terminate(); return; }
      if (active.readyState === WebSocket.OPEN) { alive = false; active.ping(); }
    }, 30_000);
    heartbeat.unref();
    active.on("pong", () => { alive = true; });
    handshake = setTimeout(() => active.close(1008, "Handshake timed out"), 15_000);
    handshake.unref();
    active.on("error", () => { if (!stopped) stateListener?.("reconnecting"); });
    active.on("message", (data) => {
      if (active !== socket) return;
      let value: GatewayServerMessage;
      try { value = record(JSON.parse(data.toString())) as unknown as GatewayServerMessage; }
      catch { active.close(1008, "Invalid response"); return; }
      void incoming(value).catch(() => { active.close(1008, "Invalid gateway response"); });
    });
    active.on("close", (code: number) => {
      if (active !== socket) return;
      linked = false; clearTimeout(handshake); clearInterval(heartbeat); failPending();
      if (unlinkReject) { clearTimeout(unlinkTimer); unlinkReject(new Error("Unlink outcome unknown; check Slack before retrying.")); unlinkReject = undefined; unlinkResolve = undefined; }
      if (stopped) return;
      if (code === 1008 && identity) { stopped = true; stateListener?.("disconnected"); return; }
      if (code === 1008) {
        stopped = true; authenticating = undefined;
        try { revokeGatewayDevice(options.root); }
        catch { stateListener?.("error"); }
        rejectAuth?.(Object.assign(new Error("Team Slack link rejected"), { code: "gateway_link_required" })); rejectAuth = undefined; return;
      }
      if (!identity) { authenticating = undefined; rejectAuth?.(new Error("Gateway connection failed")); rejectAuth = undefined; return; }
      stateListener?.("reconnecting");
      reconnect = setTimeout(connect, gatewayReconnectDelay(options.reconnectMs ?? 5000, options.random));
      reconnect.unref();
    });
  }

  function sendOperation(operation: GatewayOperation): Promise<GatewayResult> {
    if (!linked || stopped) return Promise.reject(new SlackNotSentError("Team Slack is offline"));
    if (!validOperation(operation)) return Promise.reject(new SlackNotSentError("Invalid gateway operation"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Gateway delivery outcome unknown")); }, 15_000);
      timer.unref();
      pending.set(requestId, { operation, resolve, reject, timer });
      try { send({ type: "operation", requestId, eventId: slackTransportContext.getStore()?.eventId, operation }); }
      catch (error) { pending.delete(requestId); clearTimeout(timer); reject(error); }
    });
  }

  async function operation(value: GatewayOperation): Promise<GatewayResult> {
    const result = await withSlackRetry(async () => {
      try { return { result: await sendOperation(value) }; }
      catch (error) {
        if (classifySlackFailure(error).kind === "rate-limited") throw error;
        return { error };
      }
    }, options.retry);
    if ("error" in result) throw result.error;
    return result.result;
  }

  return {
    authenticate() {
      if (authenticating && !linked) activateBinding();
      if (identity && linked) return Promise.resolve(identity);
      if (authenticating) return authenticating;
      stopped = false;
      device = readGatewayDevice(options.root);
      if (!device || device.revoked || device.url !== new URL(settings.gatewayUrl ?? "").origin) return Promise.reject(Object.assign(new Error("Connect to Team Slack in Setup first"), { code: "gateway_link_required" }));
      authenticating = new Promise((resolve, reject) => { resolveAuth = resolve; rejectAuth = reject; connect(); });
      return authenticating;
    },
    async start() { if (linked) stateListener?.("connected"); },
    async stop() {
      stopped = true; linked = false; clearTimeout(reconnect); clearTimeout(handshake); clearInterval(heartbeat);
      rejectAuth?.(new SlackNotSentError("Team Slack stopped")); rejectAuth = undefined;
      failPending();
      const active = socket;
      if (!active || active.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { active.terminate(); resolve(); }, 1000); timeout.unref();
        active.once("close", () => { clearTimeout(timeout); resolve(); });
        active.close(1000);
      });
    },
    async postMessage(message) {
      const { receipt } = await operation({ kind: "postMessage", channel: message.channel, text: message.text, blocks: message.blocks, threadTs: message.thread_ts });
      if (!receipt) throw new Error("Missing gateway receipt");
      return receipt;
    },
    async updateMessage(message) { await operation({ kind: "update", channel: message.channel, ts: message.ts, text: message.text, blocks: message.blocks }); },
    async publishHome(userId, view) { await operation({ kind: "viewsPublish", userId, view }); },
    async listMembers() { return (await operation({ kind: "listMembers" })).members!; },
    async askTeammate(input) {
      const { receipt } = await operation({ ...input, kind: "askTeammate" });
      if (!receipt) throw new Error("Missing gateway receipt");
      return receipt;
    },
    async handoff(input) {
      const { receipt } = await operation({ ...input, kind: "handoff" });
      if (!receipt) throw new Error("Missing gateway receipt");
      return receipt;
    },
    async handoffResolve(handoffId, outcome) { await operation({ kind: "handoffResolve", handoffId, outcome }); },
    async handoffStatus(handoffIds) { return (await operation({ kind: "handoffStatus", handoffIds })).handoffs!; },
    onEnvelope(listener) { envelopeListener = listener; },
    onState(listener) { stateListener = listener; },
    async unlink() {
      if (unlinkResolve) throw new Error("Unlink is already pending");
      return new Promise<void>((resolve, reject) => {
        unlinkResolve = resolve; unlinkReject = reject;
        unlinkTimer = setTimeout(() => { unlinkResolve = undefined; unlinkReject = undefined; reject(new Error("Unlink outcome unknown; check Slack before retrying.")); }, 10000);
        unlinkTimer.unref();
        try { send({ type: "unlink" }); }
        catch (error) { clearTimeout(unlinkTimer); unlinkResolve = undefined; unlinkReject = undefined; reject(error); }
      });
    },
  };
}
