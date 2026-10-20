import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { eventAudience, HANDOFF_DECLINE_ACTION, HANDOFF_PICKUP_ACTION, record, validOperation, type GatewayCapability, type GatewayEnvelope, type GatewayHandoffResult, type GatewayHandoffStatus, type GatewayIdentity, type GatewayOperation, type GatewayServerMessage, type GatewaySlackOperation } from "../../shared/slack-gateway/protocol.ts";
import { Challenge } from "./auth.ts";
import { Registry, type Device, type MessageReceipt } from "./registry.ts";
import { TokenBucket } from "./rate-limit.ts";

export interface SlackLayer {
  identity: GatewayIdentity;
  member: (userId: string) => Promise<{ name: string; dmChannelId: string }>;
  execute: (operation: GatewaySlackOperation) => Promise<{ channel: string; ts: string } | void>;
  openGroupDm?: (ownerUserId: string, helperUserId: string) => Promise<string>;
  isChannelMember?: (channel: string, userId: string) => Promise<boolean>;
}
interface Session { deviceId?: string; socket: WebSocket; requests: Set<string>; alive: boolean; capabilities: Set<GatewayCapability> }
interface Scope { deviceId: string; userId: string; channelId?: string; threadTs?: string; messageTs?: string; deadline: number; remaining: number; handoffId?: string }
export interface GatewayOptions {
  registry: Registry;
  slack: SlackLayer;
  admins?: string[];
  now?: () => number;
  trustProxy?: boolean;
  signingSecret?: string;
  log?: (metadata: { kind: string; deviceId?: string; userId?: string; elapsedMs?: number }) => void;
}

export const OFFLINE = "Your DevHub is offline — open DevHub on your laptop and try again.";
export const UNLINKED = "Link your DevHub: Setup → Slack → Team Slack";
export const COLLABORATION_TTL = 24 * 60 * 60_000;

function handoffNotSent(error: unknown, depth = 0): boolean {
  if (depth > 3) return false;
  const failure = record(error);
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "slack_webapi_rate_limited_error"].includes(String(failure.code))) return true;
  if (failure.code === "slack_webapi_platform_error" && ["channel_not_found", "not_in_channel", "is_archived", "invalid_auth", "account_inactive", "token_revoked", "missing_scope", "invalid_blocks", "invalid_arguments", "ratelimited"].includes(String(record(failure.data).error))) return true;
  return handoffNotSent(failure.original, depth + 1) || handoffNotSent(failure.cause, depth + 1);
}

function sanitiseMentions(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/<!(?:channel|here|everyone|subteam)[^>]*>|<@[^>]+>/g, "");
  if (Array.isArray(value)) return value.map(sanitiseMentions);
  if (["user", "usergroup", "broadcast"].includes(String(record(value).type))) return { type: "text", text: "[mention removed]" };
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitiseMentions(entry)]));
  return value;
}

export class SlackGateway {
  readonly server;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private readonly sessions = new Map<string, Session>();
  private readonly scopes = new Map<string, Scope>();
  private readonly seen = new Map<string, number>();
  private readonly ephemerals = new Map<string, number>();
  private readonly inFlight = new Map<string, { deviceId: string; userId: string; toUserId: string; toDeviceId?: string }>();
  private readonly ipLimit: TokenBucket;
  private readonly users: TokenBucket;
  private readonly links: TokenBucket;
  private readonly operations: TokenBucket;
  private readonly options: GatewayOptions;
  private readonly now: () => number;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private closing = false;

  constructor(options: GatewayOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.ipLimit = new TokenBucket(60, 60_000, this.now);
    this.users = new TokenBucket(20, 60_000, this.now);
    this.links = new TokenBucket(5, 10 * 60_000, this.now);
    this.operations = new TokenBucket(100, 60_000, this.now);
    this.server = createServer((request, response) => { void this.http(request, response).catch(() => this.json(response, 400, { error: "Invalid request" })); });
    this.server.requestTimeout = 10_000;
    this.server.headersTimeout = 10_000;
    this.server.on("upgrade", (request, socket, head) => {
      if (this.closing || request.url !== "/device" || request.headers.origin || this.sockets.clients.size >= 500 || !this.ipLimit.take(this.ip(request))) { socket.destroy(); return; }
      this.sockets.handleUpgrade(request, socket, head, (websocket) => this.connect(websocket));
    });
    this.heartbeat = setInterval(() => {
      void this.prune().catch(() => this.options.log?.({ kind: "prune_failed" }));
      for (const session of this.sessions.values()) {
        if (!session.alive || !this.options.registry.key(session.deviceId!)) { session.socket.terminate(); continue; }
        session.alive = false;
        session.socket.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  private ip(request: IncomingMessage): string {
    const forwarded = this.options.trustProxy ? request.headers["x-forwarded-for"] : undefined;
    return (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : request.socket.remoteAddress) ?? "unknown";
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  }

  private async http(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "GET" && request.url === "/healthz") { this.json(response, this.closing ? 503 : 200, { ok: !this.closing }); return; }
    if (request.method === "POST" && request.url === "/slack/events" && this.options.signingSecret) { await this.slackHttp(request, response); return; }
    if (request.method !== "POST" || request.url !== "/register") { this.json(response, 404, { error: "Not found" }); return; }
    if (request.headers.origin || !this.ipLimit.take(this.ip(request))) { this.json(response, 429, { error: "Try again later" }); return; }
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 4096) { this.json(response, 413, { error: "Request too large" }); request.destroy(); return; }
    }
    const input = record(JSON.parse(body));
    if (typeof input.publicKey !== "string" || typeof input.label !== "string" || input.label.length > 80) { this.json(response, 400, { error: "Invalid registration" }); return; }
    const pairing = this.options.registry.register(input.publicKey, input.label);
    this.json(response, 201, { deviceId: pairing.deviceId, code: pairing.code, expiresAt: pairing.expiresAt });
  }

  private async slackHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 256 * 1024) { this.json(response, 413, { error: "Request too large" }); request.destroy(); return; }
    }
    const timestamp = request.headers["x-slack-request-timestamp"];
    const signature = request.headers["x-slack-signature"];
    if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp) || Math.abs(this.now() / 1000 - Number(timestamp)) > 300
      || typeof signature !== "string" || !/^v0=[a-f0-9]{64}$/.test(signature)) { this.json(response, 401, { error: "Invalid Slack signature" }); return; }
    const expected = `v0=${createHmac("sha256", this.options.signingSecret!).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) { this.json(response, 401, { error: "Invalid Slack signature" }); return; }
    const form = new URLSearchParams(raw);
    const payload: unknown = request.headers["content-type"]?.startsWith("application/json") ? JSON.parse(raw) : form.has("payload") ? JSON.parse(form.get("payload")!) : Object.fromEntries(form);
    const body = record(payload);
    if (body.type === "url_verification" && typeof body.challenge === "string") { this.json(response, 200, { challenge: body.challenge }); return; }
    this.json(response, 200, {});
    const work = body.command === "/devhub" && typeof body.team_id === "string" && typeof body.user_id === "string" && typeof body.text === "string"
      ? this.command(body.team_id, body.user_id, body.text)
      : this.receive(payload, typeof body.event_id === "string" ? body.event_id : createHmac("sha256", this.options.signingSecret!).update(raw).digest("hex"));
    void work.catch(() => this.options.log?.({ kind: "slack_delivery_failed" }));
  }

  private send(session: Session, message: GatewayServerMessage): void {
    if (session.socket.readyState !== WebSocket.OPEN) return;
    if (session.socket.bufferedAmount > 1024 * 1024) { session.socket.terminate(); return; }
    session.socket.send(JSON.stringify(message));
  }

  private connect(socket: WebSocket): void {
    const challenge = new Challenge(this.now);
    const session: Session = { socket, requests: new Set(), alive: true, capabilities: new Set() };
    const timer = setTimeout(() => socket.close(1008, "Authentication required"), 10_000);
    timer.unref();
    this.send(session, { type: "challenge", nonce: challenge.nonce });
    socket.on("pong", () => { session.alive = true; if (session.deviceId) this.options.registry.seen(session.deviceId); });
    socket.on("error", () => this.options.log?.({ kind: "socket_error", deviceId: session.deviceId }));
    socket.on("close", () => {
      clearTimeout(timer);
      if (session.deviceId && this.sessions.get(session.deviceId) === session) this.sessions.delete(session.deviceId);
    });
    socket.on("message", (data, binary) => {
      if (binary) { socket.close(1008, "JSON required"); return; }
      let input: Record<string, unknown>;
      try { input = record(JSON.parse(data.toString())); }
      catch { socket.close(1008, "Invalid request"); return; }
      if (!session.deviceId) {
        const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
        const key = this.options.registry.key(deviceId);
        if (input.type !== "auth" || !key || typeof input.timestamp !== "number" || typeof input.signature !== "string"
          || !challenge.verify(deviceId, key, input.timestamp, input.signature)) {
          this.options.registry.failedAttempt(deviceId);
          socket.close(1008, "Authentication rejected"); return;
        }
        clearTimeout(timer);
        session.deviceId = deviceId;
        if (Array.isArray(input.capabilities)) for (const capability of input.capabilities) if (capability === "ask" || capability === "handoff") session.capabilities.add(capability);
        const old = this.sessions.get(deviceId);
        this.sessions.set(deviceId, session);
        old?.socket.close(1008, "Replaced");
        const device = this.options.registry.device(deviceId);
        if (device) this.linked(session, device);
        else this.send(session, { type: "awaiting_link" });
        return;
      }
      if (this.sessions.get(session.deviceId) !== session) { socket.close(1008, "Replaced"); return; }
      if (input.type === "unlink") {
        const device = this.options.registry.device(session.deviceId);
          if (device) void this.revoke(device.teamId, device.userId).catch(() => this.options.log?.({ kind: "revoke_failed" }));
        else { this.options.registry.cancel(session.deviceId); this.send(session, { type: "revoked" }); socket.close(1000); }
        return;
      }
      void this.operate(session, input).catch((error: unknown) => {
        const failure = record(error);
        const rateLimited = failure.code === "slack_webapi_rate_limited_error";
        const delay = typeof failure.retryAfter === "number" && Number.isFinite(failure.retryAfter) ? Math.max(1, Math.min(3600, failure.retryAfter)) : 1;
        if (typeof input.requestId === "string") this.send(session, { type: "result", requestId: input.requestId, ok: false, ...(rateLimited ? { retryAfter: delay } : {}) });
        this.options.log?.({ kind: "operation_failed", deviceId: session.deviceId });
      });
    });
  }

  private linked(session: Session, device: Device): void {
    const { deviceId, teamId, userId, userName, dmChannelId } = device;
    this.send(session, { type: "linked", binding: { deviceId, teamId, userId, userName, dmChannelId }, identity: this.options.slack.identity });
  }

  private async revoke(teamId: string, userId: string): Promise<void> {
    const device = this.options.registry.revoke(teamId, userId);
    if (!device) return;
    const session = this.sessions.get(device.deviceId);
    if (session) { this.send(session, { type: "revoked" }); session.socket.close(1008, "Revoked"); }
    for (const [id, scope] of this.scopes) if (scope.deviceId === device.deviceId) this.scopes.delete(id);
    await this.prune();
  }

  private async operate(session: Session, input: Record<string, unknown>): Promise<void> {
    const requestId = typeof input.requestId === "string" ? input.requestId : "";
    const reject = () => this.send(session, { type: "result", requestId, ok: false, notSent: true });
    if (input.type !== "operation" || !requestId || requestId.length > 100 || session.requests.has(requestId)) { reject(); return; }
    if (session.requests.size >= 10_000) { reject(); session.socket.close(1000, "Refresh session"); return; }
    session.requests.add(requestId);
    const device = this.options.registry.device(session.deviceId!);
    if (!device || this.sessions.get(device.deviceId) !== session || !this.operations.take(device.deviceId) || !validOperation(input.operation)) { reject(); return; }
    const operation = input.operation;
    const scope = typeof input.eventId === "string" ? this.scopes.get(input.eventId) : undefined;
    if (input.eventId !== undefined && (!scope || scope.deviceId !== device.deviceId || scope.userId !== device.userId || scope.deadline <= this.now() || scope.remaining-- <= 0)) { reject(); return; }
    if (scope?.handoffId && this.options.registry.handoff(scope.handoffId)?.status !== "pending"
      && !(operation.kind === "handoffResolve" && operation.handoffId === scope.handoffId && operation.outcome === "accepted")
      && operation.kind !== "handoffStatus"
      && !(operation.kind === "postMessage" && operation.channel === device.dmChannelId && !operation.threadTs)) { reject(); return; }
    if (["listMembers", "askTeammate", "handoff", "handoffResolve", "handoffStatus"].includes(operation.kind)) {
      await this.collaborate(session, device, operation, requestId); return;
    }
    if ("userId" in operation && operation.userId !== device.userId) { reject(); return; }
    if ("channel" in operation && operation.channel !== device.dmChannelId && operation.channel !== scope?.channelId) { reject(); return; }
    if (operation.kind === "postMessage" && operation.channel !== device.dmChannelId) {
      const threadTs = scope?.threadTs ?? scope?.messageTs;
      if (!threadTs) { reject(); return; }
      operation.threadTs ??= threadTs;
    }
    if ("threadTs" in operation && operation.threadTs && operation.channel !== device.dmChannelId && operation.threadTs !== scope?.threadTs && operation.threadTs !== scope?.messageTs) { reject(); return; }
    if (operation.kind === "update" || operation.kind === "reaction") {
      const receipt = this.options.registry.receipt(operation.channel, operation.ts);
      if (!receipt || receipt.kind === "handoff" || receipt.deviceId !== device.deviceId || receipt.userId !== device.userId) { reject(); return; }
    }
    const started = this.now();
    const receipt = await this.options.slack.execute(operation as GatewaySlackOperation);
    if (receipt) this.options.registry.rememberReceipt({ ...receipt, ...(operation.kind === "postMessage" ? { threadTs: operation.threadTs } : {}), deviceId: device.deviceId, userId: device.userId });
    this.send(session, { type: "result", requestId, ok: true, ...(receipt ? { receipt } : {}) });
    this.options.log?.({ kind: operation.kind, deviceId: device.deviceId, userId: device.userId, elapsedMs: this.now() - started });
  }

  private async collaborate(session: Session, device: Device, operation: GatewayOperation, requestId: string): Promise<void> {
    const reject = () => this.send(session, { type: "result", requestId, ok: false, notSent: true });
    const capability = operation.kind === "listMembers" || operation.kind === "askTeammate" ? "ask" : "handoff";
    if (!session.capabilities.has(capability)) { reject(); return; }
    if (operation.kind !== "handoff") await this.prune();
    if (!this.options.registry.device(device.deviceId) || this.sessions.get(device.deviceId) !== session) { reject(); return; }
    if (operation.kind === "listMembers") {
      const members = this.options.registry.list(device.teamId).filter((member) => !member.revoked && member.userId !== device.userId && member.userId !== this.options.slack.identity.userId)
        .map(({ userId, userName }) => ({ userId, userName }));
      this.send(session, { type: "result", requestId, ok: true, members }); return;
    }
    if (operation.kind === "handoffStatus") {
      const receipts = operation.handoffIds.map((id) => this.options.registry.handoff(id) ?? this.inFlight.get("handoff:" + id));
      if (receipts.some((receipt) => receipt && !((receipt.deviceId === device.deviceId && receipt.userId === device.userId)
        || (receipt.toDeviceId === device.deviceId && receipt.toUserId === device.userId)))) { reject(); return; }
      const handoffs = operation.handoffIds.map<GatewayHandoffStatus>((handoffId, index) => {
        const receipt = receipts[index];
        return { handoffId, status: receipt ? ("status" in receipt ? receipt.status! : "pending") : "unknown", ...(receipt && "byUserId" in receipt && receipt.byUserId ? { byUserId: receipt.byUserId } : {}) };
      });
      this.send(session, { type: "result", requestId, ok: true, handoffs }); return;
    }
    if (operation.kind === "handoffResolve") {
      const receipt = this.options.registry.handoff(operation.handoffId);
      if (!receipt || receipt.toUserId !== device.userId || receipt.toDeviceId !== device.deviceId) { reject(); return; }
      if (receipt.status === "accepted" && operation.outcome === "accepted") { this.options.registry.flush(); this.send(session, { type: "result", requestId, ok: true }); return; }
      if (receipt.status !== "pending") { reject(); return; }
      await this.finishHandoff(receipt, operation.outcome === "accepted" ? "accepted" : "expired");
      this.send(session, { type: "result", requestId, ok: true }); return;
    }
    if (operation.kind !== "askTeammate" && operation.kind !== "handoff") { reject(); return; }
    const recipientId = operation.kind === "askTeammate" ? operation.helperUserId : operation.toUserId;
    const id = operation.kind === "askTeammate" ? operation.askId : operation.handoffId;
    const lock = `${operation.kind}:${id}`;
    const recipient = this.options.registry.member(device.teamId, recipientId);
    if (recipientId === device.userId || recipientId === this.options.slack.identity.userId || this.inFlight.has(lock)
      || (operation.kind === "askTeammate" ? this.options.registry.ask(id) : this.options.registry.handoff(id))
      || (operation.kind === "handoff" && (!recipient || !this.options.registry.canRememberHandoff(this.inFlight.size)))) { reject(); return; }
    this.inFlight.set(lock, { deviceId: device.deviceId, userId: device.userId, toUserId: recipientId, toDeviceId: recipient?.deviceId });
    try {
      if (operation.kind === "handoff") await this.prune();
      let channel: string;
      if (operation.kind === "askTeammate") {
        if (operation.channel) {
          if (!await this.options.slack.isChannelMember?.(operation.channel, device.userId)) { reject(); return; }
          channel = operation.channel;
        } else {
          if (!this.options.slack.openGroupDm) { reject(); return; }
          channel = await this.options.slack.openGroupDm(device.userId, recipientId);
          if (!/^[CG][A-Z0-9]+$/.test(channel)) throw new Error("Invalid group DM channel");
        }
      } else {
        channel = recipient!.dmChannelId;
        const buttons = operation.blocks.flatMap((block) => {
          const elements = record(block).elements;
          return Array.isArray(elements) ? elements.map(record) : [];
        });
        const pickup = buttons.filter((button) => button.type === "button" && button.action_id === HANDOFF_PICKUP_ACTION);
        const decline = buttons.filter((button) => button.type === "button" && button.action_id === HANDOFF_DECLINE_ACTION);
        if (pickup.length !== 1 || decline.length !== 1 || typeof pickup[0].value !== "string" || pickup[0].value.length > 1900) { reject(); return; }
        try { if (!Object.keys(record(JSON.parse(pickup[0].value))).length) { reject(); return; } }
        catch { reject(); return; }
      }
      if (!this.options.registry.device(device.deviceId) || this.sessions.get(device.deviceId) !== session
        || (operation.kind === "handoff" && this.options.registry.member(device.teamId, recipientId)?.deviceId !== recipient!.deviceId)) { reject(); return; }
      const content = sanitiseMentions({ text: operation.text, blocks: operation.blocks }) as { text: string; blocks?: unknown[] };
      const mention = `<@${recipientId}>`;
      const text = operation.kind === "askTeammate" ? `${mention} ${content.text}`.slice(0, 40000) : content.text;
      const blocks = operation.kind === "askTeammate" && content.blocks
        ? [{ type: "section", text: { type: "mrkdwn", text: mention } }, ...content.blocks.slice(0, 49)] : content.blocks;
      let receipt: Awaited<ReturnType<SlackLayer["execute"]>>;
      try { receipt = await this.options.slack.execute({ kind: "postMessage", channel, text, blocks }); }
      catch (error) {
        if (operation.kind === "handoff" && handoffNotSent(error)) { reject(); return; }
        throw error;
      }
      if (!receipt || receipt.channel !== channel) throw new Error("Slack receipt missing");
      this.options.registry.rememberReceipt({ ...receipt, deviceId: device.deviceId, userId: device.userId, expiresAt: this.now() + COLLABORATION_TTL,
        ...(operation.kind === "askTeammate" ? { kind: "ask", askId: operation.askId, helperUserId: recipientId, ...(!operation.channel ? { groupDm: true } : {}) }
          : { kind: "handoff", handoffId: operation.handoffId, toUserId: recipientId, toDeviceId: recipient!.deviceId, status: "pending" }) });
      this.options.registry.flush();
      await this.prune();
      this.send(session, { type: "result", requestId, ok: true, receipt });
    } finally { this.inFlight.delete(lock); }
  }

  private async finishHandoff(receipt: MessageReceipt, status: GatewayHandoffResult["status"]): Promise<void> {
    if (this.options.registry.handoff(receipt.handoffId!)?.status !== "pending") return;
    const result: GatewayHandoffResult = { handoffId: receipt.handoffId!, status, byUserId: receipt.toUserId! };
    this.options.registry.rememberReceipt({ ...receipt, status, byUserId: receipt.toUserId });
    this.options.registry.flush();
    const owner = this.options.registry.device(receipt.deviceId);
    const session = owner && this.sessions.get(owner.deviceId);
    if (owner && session?.capabilities.has("handoff") && session.socket.readyState === WebSocket.OPEN && session.socket.bufferedAmount <= 1024 * 1024) {
      const id = randomUUID();
      const deadline = this.now() + 120_000;
      this.scopes.set(id, { deviceId: owner.deviceId, userId: owner.userId, channelId: owner.dmChannelId, deadline, remaining: 30 });
      this.send(session, { type: "event", envelope: { id, kind: "handoff_result", teamId: this.options.slack.identity.teamId, userId: receipt.userId, payload: result, ...result, deadline } });
    } else {
      try { await this.reply(receipt.userId, status === "accepted" ? "<@" + receipt.toUserId + "> picked up your handoff." : status === "declined" ? "<@" + receipt.toUserId + "> declined your handoff. It's yours again." : "Your handoff to <@" + receipt.toUserId + "> expired. It's yours again."); }
      catch { this.options.log?.({ kind: "handoff_notification_failed", deviceId: receipt.deviceId }); }
    }
    try { await this.options.slack.execute({ kind: "update", channel: receipt.channel, ts: receipt.ts, text: status === "accepted" ? "Picked up" : status === "declined" ? "Declined" : "Expired", blocks: [] }); }
    catch { this.options.log?.({ kind: "handoff_card_update_failed", deviceId: receipt.deviceId }); }
  }

  private async reply(userId: string, text: string): Promise<void> {
    const member = await this.options.slack.member(userId);
    await this.options.slack.execute({ kind: "postMessage", channel: member.dmChannelId, text });
  }

  async command(teamId: string, userId: string, text: string): Promise<void> {
    if (teamId !== this.options.slack.identity.teamId || !this.users.take(`${teamId}:${userId}`)) return;
    const [command, code, ...extra] = text.trim().split(/\s+/);
    if (command?.toLowerCase() === "link") {
      if (!this.links.take(`${teamId}:${userId}`)) { await this.reply(userId, "Too many link attempts. Try again in ten minutes."); return; }
      const member = await this.options.slack.member(userId);
      const result = !extra.length && /^[A-Z2-9]{8}$/i.test(code ?? "")
        ? this.options.registry.link(code, { teamId, userId, userName: member.name, dmChannelId: member.dmChannelId }) : undefined;
      if (!result) { await this.reply(userId, "That link code is invalid or expired. Connect again in Setup → Slack → Team Slack."); return; }
      if (result.replaced) {
        const previous = this.sessions.get(result.replaced.deviceId);
        if (previous) { this.send(previous, { type: "revoked" }); previous.socket.close(1008, "Re-linked"); }
        await this.prune();
      }
      const session = this.sessions.get(result.device.deviceId);
      if (session) this.linked(session, result.device);
      await this.reply(userId, "Link requested. Confirm your Slack name in DevHub → Setup → Team Slack before asking me anything.");
      return;
    }
    if (command?.toLowerCase() === "unlink") { await this.revoke(teamId, userId); await this.reply(userId, "Your DevHub has been unlinked."); return; }
    if (command?.toLowerCase() === "devices" && this.options.admins?.includes(userId)) {
      const devices = this.options.registry.list(teamId);
      await this.reply(userId, devices.length ? devices.map((device) => `${device.userId} · ${device.deviceId} · ${device.label.replace(/[<>\r\n]/g, "")} · linked ${new Date(device.linkedAt).toISOString()} · seen ${new Date(device.lastSeen).toISOString()} · ${device.revoked ? "revoked" : "linked"}`).join("\n").slice(0, 35000) : "No linked devices.");
      return;
    }
    await this.reply(userId, "Use /devhub link CODE or /devhub unlink.");
  }

  async receive(payload: unknown, id: string = randomUUID()): Promise<void> {
    const audience = eventAudience(payload);
    if (!audience || audience.teamId !== this.options.slack.identity.teamId || audience.userId === this.options.slack.identity.userId || this.closing) return;
    await this.prune();
    if (this.seen.has(id)) return;
    if (this.seen.size >= 10_000) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(id, this.now());
    const body = record(payload);
    const event = record(body.event);
    const text = event.text;
    if (audience.kind === "message" && !event.thread_ts && audience.channelId?.startsWith("G")) {
      const ask = this.options.registry.groupAsk(audience.channelId);
      if (ask?.userId === audience.userId) return;
      if (ask?.helperUserId === audience.userId) {
        const owner = this.options.registry.device(ask.deviceId);
        if (owner) await this.helperReply(owner, ask, payload, id);
        return;
      }
    }
    if (audience.kind === "message" && !audience.channelId?.startsWith("D") && !(typeof text === "string" && text.includes(`<@${this.options.slack.identity.userId}>`))) {
      if (typeof event.thread_ts !== "string") return;
      const receipt = this.options.registry.thread(audience.channelId ?? "", event.thread_ts);
      if (!receipt) return;
      const owner = this.options.registry.device(receipt.deviceId);
      if (receipt.userId !== audience.userId) {
        if (owner && receipt.kind === "ask" && receipt.helperUserId === audience.userId && receipt.expiresAt! > this.now()) {
          await this.helperReply(owner, receipt, payload, id); return;
        }
        await this.threadEphemeral(audience.userId, receipt, `This is <@${receipt.userId}>'s task. Ask them to add you.`); return;
      }
      if (!owner || owner.userId !== audience.userId || !this.options.registry.botThread(owner.deviceId, audience.userId, audience.channelId ?? "", event.thread_ts)) return;
    }
    if (audience.kind === "message" && audience.channelId?.startsWith("D") && typeof text === "string" && /^(link\b|unlink\s*$|devices\s*$)/i.test(text.trim())) {
      await this.command(audience.teamId, audience.userId, text); return;
    }
    if (!this.users.take(`${audience.teamId}:${audience.userId}`)) return;
    const device = this.options.registry.member(audience.teamId, audience.userId);
    if (!device) { await this.reply(audience.userId, UNLINKED); return; }
    let handoff: GatewayEnvelope["handoff"];
    const receipt = audience.messageTs ? this.options.registry.receipt(audience.channelId ?? "", audience.messageTs) : undefined;
    const actions = Array.isArray(body.actions) ? body.actions.map(record) : [];
    const isHandoffAction = actions.some((action) => [HANDOFF_PICKUP_ACTION, HANDOFF_DECLINE_ACTION].includes(String(action.action_id)));
    if (receipt?.kind === "handoff" || isHandoffAction) {
      if (!receipt || receipt.kind !== "handoff" || audience.kind !== "block_actions" || actions.length !== 1 || !isHandoffAction
        || actions[0].type !== "button" || receipt.status !== "pending" || receipt.expiresAt! <= this.now()
        || receipt.toUserId !== audience.userId || receipt.toDeviceId !== device.deviceId || !this.options.registry.device(receipt.deviceId)) {
        await this.reply(audience.userId, "That card belongs to another session or member. Ask your own DevHub again."); return;
      }
      handoff = { handoffId: receipt.handoffId!, fromUserId: receipt.userId, fromName: this.options.registry.device(receipt.deviceId)!.userName };
    } else if (audience.messageTs && (!receipt || receipt.userId !== audience.userId || receipt.deviceId !== device.deviceId)) {
      await this.reply(audience.userId, "That card belongs to another session or member. Ask your own DevHub again."); return;
    }
    const session = this.sessions.get(device.deviceId);
    if (handoff && actions[0].action_id === HANDOFF_DECLINE_ACTION) await this.finishHandoff(receipt!, "declined");
    if (!session || session.socket.readyState !== WebSocket.OPEN || (handoff && !session.capabilities.has("handoff"))) {
      if (!handoff || actions[0].action_id !== HANDOFF_DECLINE_ACTION) await this.reply(audience.userId, OFFLINE);
      return;
    }
    const deadline = this.now() + 120_000;
    this.scopes.set(id, { deviceId: device.deviceId, userId: device.userId, channelId: audience.channelId, threadTs: audience.threadTs, messageTs: audience.messageTs, deadline, remaining: 30, ...(handoff ? { handoffId: handoff.handoffId } : {}) });
    const envelope: GatewayEnvelope = { id, kind: audience.kind, teamId: audience.teamId, userId: audience.userId, channelId: audience.channelId, threadTs: audience.threadTs, payload, deadline, ...(handoff ? { handoff } : {}) };
    this.send(session, { type: "event", envelope });
    this.options.log?.({ kind: audience.kind, deviceId: device.deviceId, userId: device.userId });
  }

  private async helperReply(owner: Device, receipt: MessageReceipt, payload: unknown, id: string): Promise<void> {
    const session = this.sessions.get(owner.deviceId);
    if (!session?.capabilities.has("ask") || session.socket.readyState !== WebSocket.OPEN || session.socket.bufferedAmount > 1024 * 1024) {
      await this.threadEphemeral(receipt.helperUserId!, receipt, `<@${owner.userId}>'s DevHub is offline; they'll see your reply in Slack.`); return;
    }
    if (!this.users.take(`${owner.teamId}:${receipt.helperUserId}`)) return;
    const helper = this.options.registry.member(owner.teamId, receipt.helperUserId!) ?? await this.options.slack.member(receipt.helperUserId!);
    const name = "userName" in helper ? helper.userName : helper.name;
    const deadline = this.now() + 120_000;
    this.scopes.set(id, { deviceId: owner.deviceId, userId: owner.userId, channelId: owner.dmChannelId, deadline, remaining: 30 });
    this.send(session, { type: "event", envelope: { id, kind: "helper_reply", teamId: owner.teamId, userId: owner.userId, channelId: receipt.channel, threadTs: receipt.ts,
      helper: { userId: receipt.helperUserId!, name }, ask: { askId: receipt.askId!, channel: receipt.channel, threadTs: receipt.ts }, payload, deadline } });
  }

  private async threadEphemeral(userId: string, receipt: MessageReceipt, text: string): Promise<void> {
    const key = `${userId}:${receipt.channel}:${receipt.threadTs ?? receipt.ts}`;
    if ((this.ephemerals.get(key) ?? 0) > this.now() || this.ephemerals.size >= 10_000) return;
    this.ephemerals.set(key, this.now() + 10 * 60_000);
    await this.options.slack.execute({ kind: "ephemeral", channel: receipt.channel, threadTs: receipt.threadTs ?? receipt.ts, userId, text });
  }

  private async prune(): Promise<void> {
    for (const [id, scope] of this.scopes) if (scope.deadline <= this.now()) this.scopes.delete(id);
    for (const [id, at] of this.seen) if (at + 10 * 60_000 < this.now()) this.seen.delete(id);
    for (const [key, expiresAt] of this.ephemerals) if (expiresAt <= this.now()) this.ephemerals.delete(key);
    for (const receipt of this.options.registry.pendingHandoffs()) {
      const recipient = this.options.registry.member(this.options.slack.identity.teamId, receipt.toUserId!);
      if (receipt.expiresAt! <= this.now() || !this.options.registry.device(receipt.deviceId) || !recipient || recipient.deviceId !== receipt.toDeviceId) await this.finishHandoff(receipt, "expired");
    }
  }

  async listen(port = 0, host = "127.0.0.1"): Promise<number> {
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(port, host, () => { this.server.off("error", reject); resolve(); }); });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Gateway did not bind");
    return address.port;
  }

  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.heartbeat);
    for (const socket of this.sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
    if (this.server.listening) await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    this.options.registry.flush();
  }
}
