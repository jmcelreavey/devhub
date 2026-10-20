import { LogLevel, SocketModeClient } from "@slack/socket-mode";
import { WebClient, type KnownBlock } from "@slack/web-api";
import { record, type GatewaySlackOperation } from "../../shared/slack-gateway/protocol.ts";
import type { SlackGateway, SlackLayer } from "./gateway.ts";

const logger = { debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, setName() {}, getLevel: () => LogLevel.ERROR };

export async function slackLayer(botToken: string, now = Date.now): Promise<SlackLayer> {
  const web = new WebClient(botToken, { logger, timeout: 10000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
  const identity = await web.auth.test();
  if (!identity.user_id || !identity.team_id) throw new Error("Slack authentication failed");
  const memberships = new Map<string, { member: boolean; expiresAt: number }>();
  return {
    identity: { userId: identity.user_id, teamId: identity.team_id, name: identity.user ?? "DevHub" },
    async member(userId) {
      const [user, dm] = await Promise.all([web.users.info({ user: userId }), web.conversations.open({ users: userId })]);
      if (!dm.channel?.id) throw new Error("Could not open member DM");
      return { name: user.user?.name ?? userId, dmChannelId: dm.channel.id };
    },
    async openGroupDm(ownerUserId, helperUserId) {
      const result = await web.conversations.open({ users: `${ownerUserId},${helperUserId}` });
      if (!result.channel?.id) throw new Error("Could not open group DM");
      return result.channel.id;
    },
    async isChannelMember(channel, userId) {
      const key = `${channel}:${userId}`;
      const cached = memberships.get(key);
      if (cached && cached.expiresAt > now()) return cached.member;
      const started = now();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let member = false;
      do {
        const result = await web.conversations.members({ channel, cursor, limit: 200 });
        if (!Array.isArray(result.members)) throw new Error("Slack membership missing");
        member = result.members.includes(userId);
        cursor = result.response_metadata?.next_cursor?.trim() || undefined;
        if (cursor && cursors.has(cursor)) throw new Error("Slack membership cursor repeated");
        if (cursor) cursors.add(cursor);
        if (cursors.size > 1000) throw new Error("Slack membership pagination limit reached");
      } while (cursor && !member);
      for (const [id, entry] of memberships) if (entry.expiresAt <= now()) memberships.delete(id);
      if (memberships.size >= 1000) memberships.delete(memberships.keys().next().value!);
      memberships.set(key, { member, expiresAt: started + 5 * 60_000 });
      return member;
    },
    async execute(operation: GatewaySlackOperation) {
      switch (operation.kind) {
        case "postMessage": {
          const result = await web.chat.postMessage({ channel: operation.channel, text: operation.text, blocks: operation.blocks as KnownBlock[] | undefined, thread_ts: operation.threadTs, parse: "none", unfurl_links: false, unfurl_media: false });
          if (!result.channel || !result.ts) throw new Error("Slack receipt missing");
          return { channel: result.channel, ts: result.ts };
        }
        case "update": await web.chat.update({ channel: operation.channel, ts: operation.ts, text: operation.text, blocks: operation.blocks as KnownBlock[] | undefined, parse: "none" }); return;
        case "ephemeral": await web.chat.postEphemeral({ channel: operation.channel, user: operation.userId, text: operation.text, blocks: operation.blocks as KnownBlock[] | undefined, thread_ts: operation.threadTs }); return;
        case "viewsPublish": await web.views.publish({ user_id: operation.userId, view: { type: "home", blocks: operation.view.blocks as KnownBlock[] } }); return;
        case "reaction": await web.reactions[operation.remove ? "remove" : "add"]({ channel: operation.channel, timestamp: operation.ts, name: operation.name }); return;
      }
    },
  };
}

export function socketSlack(appToken: string, gateway: SlackGateway): SocketModeClient {
  const socket = new SocketModeClient({ appToken, logger, clientOptions: { timeout: 10000 } });
  socket.on("slack_event", (event: { envelope_id: string; type: string; body: unknown; ack: () => Promise<void> }) => {
    void (async () => {
      await event.ack();
      const body = record(event.body);
      if (event.type === "slash_commands" && typeof body.team_id === "string" && typeof body.user_id === "string" && typeof body.text === "string" && body.command === "/devhub") await gateway.command(body.team_id, body.user_id, body.text);
      else await gateway.receive(event.body, event.envelope_id);
    })().catch(() => console.warn(JSON.stringify({ kind: "slack_delivery_failed" })));
  });
  socket.on("error", () => console.warn(JSON.stringify({ kind: "slack_connection_error" })));
  return socket;
}
