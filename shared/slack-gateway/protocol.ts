export interface GatewayBinding {
  deviceId: string;
  teamId: string;
  userId: string;
  userName: string;
  dmChannelId: string;
}

export interface GatewayIdentity { userId: string; name: string; teamId: string }
export type GatewayEventKind = "message" | "block_actions" | "view_submission" | "view_closed" | "app_home_opened" | "reaction_added" | "helper_reply" | "handoff_result";
export type GatewayCapability = "ask" | "handoff";
export type HandoffStatus = "pending" | "accepted" | "declined" | "expired";
export interface GatewayMember { userId: string; userName: string }
export interface GatewayHandoffStatus { handoffId: string; status: HandoffStatus | "unknown"; byUserId?: string }
export interface GatewayHandoffResult { handoffId: string; status: Exclude<HandoffStatus, "pending">; byUserId: string }
export const HANDOFF_PICKUP_ACTION = "devhub_handoff_pickup";
export const HANDOFF_DECLINE_ACTION = "devhub_handoff_decline";
export interface GatewayEnvelope {
  id: string;
  kind: GatewayEventKind;
  teamId: string;
  userId: string;
  channelId?: string;
  threadTs?: string;
  payload: unknown;
  deadline: number;
  helper?: { userId: string; name: string };
  ask?: { askId: string; channel: string; threadTs: string };
  handoff?: { handoffId: string; fromUserId: string; fromName: string };
  handoffId?: string;
  status?: GatewayHandoffResult["status"];
  byUserId?: string;
}

export interface GatewayContent { text: string; blocks?: unknown[] }
export type GatewayOperation =
  | { kind: "listMembers" }
  | ({ kind: "askTeammate"; askId: string; helperUserId: string; channel?: string } & GatewayContent)
  | { kind: "handoff"; handoffId: string; toUserId: string; text: string; blocks: unknown[] }
  | { kind: "handoffResolve"; handoffId: string; outcome: "accepted" | "failed" }
  | { kind: "handoffStatus"; handoffIds: string[] }
  | ({ kind: "postMessage"; channel: string; threadTs?: string } & GatewayContent)
  | ({ kind: "update"; channel: string; ts: string } & GatewayContent)
  | ({ kind: "ephemeral"; channel: string; userId: string; threadTs?: string } & GatewayContent)
  | { kind: "viewsPublish"; userId: string; view: { type: "home"; blocks: unknown[] } }
  | { kind: "reaction"; channel: string; ts: string; name: string; remove?: boolean };

export type GatewayServerMessage =
  | { type: "challenge"; nonce: string }
  | { type: "awaiting_link" }
  | { type: "linked"; binding: GatewayBinding; identity: GatewayIdentity }
  | { type: "revoked" }
  | { type: "event"; envelope: GatewayEnvelope }
  | { type: "result"; requestId: string; ok: boolean; receipt?: { channel: string; ts: string }; members?: GatewayMember[]; handoffs?: GatewayHandoffStatus[]; retryAfter?: number; notSent?: boolean };

export type GatewaySlackOperation = Exclude<GatewayOperation, { kind: "listMembers" | "askTeammate" | "handoff" | "handoffResolve" | "handoffStatus" }>;
export type GatewayResult = Extract<GatewayServerMessage, { type: "result" }>;
export const validSlackUser = (value: unknown): value is string => typeof value === "string" && /^[UW][A-Z0-9]+$/.test(value);
export const validGatewayId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function gatewayUrl(value: string): URL {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")
    || !["https:", "wss:", ...(local ? ["http:", "ws:"] : [])].includes(url.protocol)) throw new Error("Use an HTTPS gateway URL (HTTP is only allowed on localhost).");
  url.protocol = ["ws:", "http:"].includes(url.protocol) ? "http:" : "https:";
  return url;
}

export function gatewaySocketUrl(value: string): string {
  const url = gatewayUrl(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/device";
  return url.toString();
}

export function validOperation(value: unknown): value is GatewayOperation {
  const operation = record(value);
  const channel = typeof operation.channel === "string" && /^[CDG][A-Z0-9]+$/.test(operation.channel);
  const timestamp = typeof operation.ts === "string" && /^\d+\.\d+$/.test(operation.ts);
  const content = typeof operation.text === "string" && operation.text.length <= 40000
    && (operation.blocks === undefined || (Array.isArray(operation.blocks) && operation.blocks.length <= 50));
  if (operation.threadTs !== undefined && (typeof operation.threadTs !== "string" || !/^\d+\.\d+$/.test(operation.threadTs))) return false;
  switch (operation.kind) {
    case "listMembers": return Object.keys(operation).length === 1;
    case "askTeammate": return validGatewayId(operation.askId) && validSlackUser(operation.helperUserId) && content
      && (operation.channel === undefined || (typeof operation.channel === "string" && /^[CG][A-Z0-9]+$/.test(operation.channel)))
      && Object.keys(operation).every((key) => ["kind", "askId", "helperUserId", "channel", "text", "blocks"].includes(key));
    case "handoff": return validGatewayId(operation.handoffId) && validSlackUser(operation.toUserId) && content && Array.isArray(operation.blocks)
      && Object.keys(operation).every((key) => ["kind", "handoffId", "toUserId", "text", "blocks"].includes(key));
    case "handoffResolve": return validGatewayId(operation.handoffId) && (operation.outcome === "accepted" || operation.outcome === "failed")
      && Object.keys(operation).every((key) => ["kind", "handoffId", "outcome"].includes(key));
    case "handoffStatus": return Array.isArray(operation.handoffIds) && operation.handoffIds.length <= 50 && operation.handoffIds.every(validGatewayId)
      && new Set(operation.handoffIds).size === operation.handoffIds.length && Object.keys(operation).every((key) => ["kind", "handoffIds"].includes(key));
    case "postMessage": return channel && content;
    case "update": return channel && timestamp && content;
    case "ephemeral": return channel && content && typeof operation.userId === "string";
    case "reaction": return channel && timestamp && typeof operation.name === "string" && /^[a-z0-9_+-]{1,100}$/.test(operation.name) && (operation.remove === undefined || typeof operation.remove === "boolean");
    case "viewsPublish": {
      const view = record(operation.view);
      return typeof operation.userId === "string" && view.type === "home" && Array.isArray(view.blocks) && view.blocks.length <= 100;
    }
    default: return false;
  }
}

export function eventAudience(payload: unknown): { kind: GatewayEventKind; teamId: string; userId: string; channelId?: string; threadTs?: string; messageTs?: string } | undefined {
  const body = record(payload);
  const event = record(body.event);
  const type = body.type === "block_actions" || body.type === "view_submission" || body.type === "view_closed" ? body.type : event.type;
  const teamId = typeof body.team_id === "string" ? body.team_id : record(body.team).id;
  const userId = typeof event.user === "string" ? event.user : record(body.user).id;
  if (typeof teamId !== "string" || typeof userId !== "string") return;
  if (!["message", "app_mention", "block_actions", "view_submission", "view_closed", "app_home_opened", "reaction_added"].includes(String(type))) return;
  if (event.bot_id || event.bot_profile || event.subtype || event.hidden) return;
  const item = record(event.item);
  const container = record(body.container);
  const channel = event.channel ?? item.channel ?? record(body.channel).id;
  const thread = event.thread_ts ?? event.ts ?? item.ts ?? record(body.message).thread_ts ?? container.message_ts;
  return {
    kind: type === "app_mention" ? "message" : type as GatewayEventKind, teamId, userId,
    ...(typeof channel === "string" ? { channelId: channel } : {}),
    ...(typeof thread === "string" ? { threadTs: thread } : {}),
    ...(typeof container.message_ts === "string" ? { messageTs: container.message_ts } : {}),
  };
}
