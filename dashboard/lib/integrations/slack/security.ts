import { z } from "zod";
import { CAPABILITY_ACTIONS } from "./capabilities-route";
import type { SlackEnvelope, SlackIdentity } from "./client";
import type { SlackSettings } from "./shared";
import { eventAudience } from "@shared/slack-gateway/protocol";
import { TEAM_ACTIONS } from "@/lib/team/cards";

export function allowedGatewayEnvelope(envelope: SlackEnvelope, settings: SlackSettings, now = Date.now()): boolean {
  const gateway = envelope.gateway;
  if (settings.mode !== "gateway") return !gateway;
  if (!gateway || !settings.deviceId || gateway.deviceId !== settings.deviceId) return false;
  const event = gateway.envelope;
  const audience = eventAudience(envelope.body);
  if (event.kind === "helper_reply" || event.kind === "handoff_result") {
    if (event.id !== envelope.envelopeId || event.deadline <= now || event.deadline > now + 180_000 || event.teamId !== settings.teamId || event.userId !== settings.allowedUserId) return false;
    if (event.kind === "handoff_result") return !!event.handoffId && !!event.byUserId && ["accepted", "declined", "expired"].includes(event.status ?? "");
    return !!audience && audience.kind === "message" && audience.teamId === event.teamId && audience.userId === event.helper?.userId && audience.channelId === event.ask?.channel && event.channelId === event.ask?.channel && event.threadTs === event.ask?.threadTs;
  }
  return !!audience && event.id === envelope.envelopeId && event.deadline > now && event.deadline <= now + 180_000
    && event.teamId === settings.teamId && event.userId === settings.allowedUserId
    && audience.teamId === event.teamId && audience.userId === event.userId && audience.kind === event.kind
    && audience.channelId === event.channelId && audience.threadTs === event.threadTs;
}

const EventSchema = z.object({
  team_id: z.string(),
  event_id: z.string().min(1).max(200),
  event: z.object({
    type: z.enum(["message", "app_mention"]),
    user: z.string(), channel: z.string(), text: z.string().max(40000), ts: z.string().regex(/^\d+\.\d+$/),
    thread_ts: z.string().regex(/^\d+\.\d+$/).optional(),
    team: z.string().optional(),
    bot_id: z.string().optional(), bot_profile: z.unknown().optional(), subtype: z.string().optional(), hidden: z.boolean().optional(),
  }),
});

const ReactionSchema = z.object({
  team_id: z.string(),
  event_id: z.string().min(1).max(200),
  event: z.object({
    type: z.literal("reaction_added"),
    user: z.string(), reaction: z.string().max(100),
    item: z.object({ type: z.literal("message"), channel: z.string(), ts: z.string().regex(/^\d+\.\d+$/) }),
    item_user: z.string().optional(),
  }),
});

const HomeOpenedSchema = z.object({
  team_id: z.string(),
  event_id: z.string().min(1).max(200),
  event: z.object({ type: z.literal("app_home_opened"), user: z.string(), tab: z.string() }),
});

const ACTION_IDS = z.enum(["devhub_answer", "devhub_confirm_answer", "devhub_cancel_answer", "devhub_retry", "devhub_confirm_retry", "devhub_cancel_retry", "devhub_tool_confirm", "devhub_tool_cancel", "devhub_tool_undo", "devhub_tool_view", "devhub_need_plan", "devhub_need_implement", "devhub_home_refresh", "devhub_tool_pick_1", "devhub_tool_pick_2", "devhub_tool_pick_3", "devhub_tool_pick_4", "devhub_tool_pick_5", "devhub_tool_choose_1", "devhub_tool_choose_2", "devhub_tool_choose_3", "devhub_tool_choose_4", "devhub_tool_choose_5", "devhub_open", "devhub_tool_capabilities_home", ...CAPABILITY_ACTIONS, ...TEAM_ACTIONS]);
const ActionsSchema = z.array(z.object({
  type: z.literal("button"),
  action_id: z.union([ACTION_IDS, z.enum(["devhub_approve_plan", "devhub_revise_plan", "devhub_answer_option_0", "devhub_answer_option_1", "devhub_answer_option_2", "devhub_answer_option_3", "devhub_answer_option_4", "devhub_answer_option_5"])]),
  value: z.string().max(2000).optional(),
  action_ts: z.string().regex(/^\d+\.\d+$/),
}).refine((action) => CAPABILITY_ACTIONS.includes(action.action_id) || !action.value || action.value.length <= 128)).length(1);

const TeamInteractionSchema = z.object({
  type: z.literal("block_actions"), team: z.object({ id: z.string() }), user: z.object({ id: z.string() }), channel: z.object({ id: z.string() }),
  container: z.object({ type: z.literal("message"), channel_id: z.string(), message_ts: z.string().regex(/^\d+\.\d+$/) }),
  message: z.object({ ts: z.string().regex(/^\d+\.\d+$/) }),
  actions: z.array(z.object({ type: z.enum(["button", "users_select", "conversations_select", "checkboxes"]), action_id: z.enum(TEAM_ACTIONS), action_ts: z.string().regex(/^\d+\.\d+$/), block_id: z.string().max(255).optional(), value: z.string().max(1900).optional(), selected_user: z.string().regex(/^[UW][A-Z0-9]+$/).optional() })).length(1),
  state: z.object({ values: z.record(z.string(), z.record(z.string(), z.unknown())) }).optional(),
});

const MessageInteractionSchema = z.object({
  type: z.literal("block_actions"),
  trigger_id: z.string().max(500).optional(),
  team: z.object({ id: z.string() }),
  user: z.object({ id: z.string() }),
  channel: z.object({ id: z.string() }),
  container: z.object({ type: z.literal("message"), channel_id: z.string(), message_ts: z.string().regex(/^\d+\.\d+$/), is_ephemeral: z.literal(false).optional() }),
  message: z.object({ ts: z.string().regex(/^\d+\.\d+$/), thread_ts: z.string().regex(/^\d+\.\d+$/).optional() }),
  actions: ActionsSchema,
});

/** A click in the App Home tab: it arrives with the view, not a channel or a message. */
const HomeInteractionSchema = z.object({
  type: z.literal("block_actions"),
  team: z.object({ id: z.string() }),
  user: z.object({ id: z.string() }),
  container: z.object({ type: z.literal("view"), view_id: z.string() }),
  view: z.object({ type: z.literal("home") }),
  actions: ActionsSchema,
});

const PlanRevisionSchema = z.object({
  type: z.literal("view_submission"), team: z.object({ id: z.string() }), user: z.object({ id: z.string() }),
  view: z.object({
    id: z.string().min(1).max(100), callback_id: z.literal("devhub_submit_plan_revision"),
    private_metadata: z.string().regex(/^[a-f0-9]{64}:[a-f0-9-]{36}$/),
    state: z.object({ values: z.object({ plan_revision: z.object({ guidance: z.object({ type: z.literal("plain_text_input"), value: z.string().min(1).max(3000).refine((text) => !!text.trim()) }) }) }) }),
  }),
});

export function slackIdentityAllowed(settings: SlackSettings, identity: SlackIdentity): boolean {
  return (!settings.teamId || settings.teamId === identity.teamId) && settings.allowedUserId !== identity.userId;
}

export function allowedSlackMessage(body: unknown, settings: SlackSettings, identity: SlackIdentity) {
  const parsed = EventSchema.safeParse(body);
  if (!parsed.success || !slackIdentityAllowed(settings, identity)) return null;
  const { event, event_id: eventId, team_id: teamId } = parsed.data;
  if (event.user !== settings.allowedUserId || event.channel !== settings.channelId || teamId !== identity.teamId
    || (event.team && event.team !== teamId) || event.user === identity.userId || event.bot_id || event.bot_profile || event.subtype || event.hidden) return null;
  return { eventId, teamId, userId: event.user, channelId: event.channel, text: event.text, ts: event.ts, threadTs: event.thread_ts };
}

export function allowedSlackInteraction(body: unknown, settings: SlackSettings, identity: SlackIdentity) {
  if (!slackIdentityAllowed(settings, identity)) return null;
  const revision = PlanRevisionSchema.safeParse(body);
  if (revision.success) {
    const { team, user, view } = revision.data;
    if (settings.mode === "gateway" || user.id !== settings.allowedUserId || team.id !== identity.teamId) return null;
    const [value, revisionToken] = view.private_metadata.split(":");
    return { surface: "modal" as const, teamId: team.id, userId: user.id, channelId: settings.channelId, ts: "", action: "devhub_submit_plan_revision" as const, actionTs: view.id, value, revisionToken, revisionText: view.state.values.plan_revision.guidance.value };
  }
  const teamAction = TeamInteractionSchema.safeParse(body);
  if (teamAction.success && settings.mode === "gateway") {
    const { team, user, channel, container, message, actions: [action], state } = teamAction.data;
    if (user.id !== settings.allowedUserId || channel.id !== settings.channelId || team.id !== identity.teamId || container.channel_id !== channel.id || container.message_ts !== message.ts) return null;
    return { surface: "message" as const, teamId: team.id, userId: user.id, channelId: channel.id, ts: message.ts, action: action.action_id, value: action.value, actionTs: action.action_ts, blockId: action.block_id, selectedUserId: action.selected_user, stateValues: state?.values };
  }
  const parsed = MessageInteractionSchema.safeParse(body);
  if (parsed.success) {
    const { team, user, channel, container, message, actions: [action], trigger_id: triggerId } = parsed.data;
    if (user.id !== settings.allowedUserId || channel.id !== settings.channelId || team.id !== identity.teamId
      || container.channel_id !== channel.id || container.message_ts !== message.ts) return null;
    return { surface: "message" as const, teamId: team.id, userId: user.id, channelId: channel.id, ts: message.ts, ...(message.thread_ts ? { threadTs: message.thread_ts } : {}), action: action.action_id, value: action.value, actionTs: action.action_ts, triggerId };
  }
  const home = HomeInteractionSchema.safeParse(body);
  if (!home.success) return null;
  const { team, user, actions: [action] } = home.data;
  if (user.id !== settings.allowedUserId || team.id !== identity.teamId) return null;
  // The Home tab has no channel or message: work started there answers in the configured channel, and `ts` is unused.
  return { surface: "home" as const, teamId: team.id, userId: user.id, channelId: settings.channelId, ts: "", action: action.action_id, value: action.value, actionTs: action.action_ts };
}

const CHECK_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check"]);

/** Skin-tone suffixes ("white_check_mark::skin-tone-3") don't change which emoji it is. */
export function isCheckReaction(name: string): boolean {
  return CHECK_REACTIONS.has(name.split("::")[0]);
}

/**
 * A ✅-style reaction added by the configured user, in the configured channel and workspace, on a
 * message the bot posted. Anything else (someone else, another channel, a bot, a removal) is null.
 */
export function allowedSlackReaction(body: unknown, settings: SlackSettings, identity: SlackIdentity) {
  const parsed = ReactionSchema.safeParse(body);
  if (!parsed.success || !slackIdentityAllowed(settings, identity)) return null;
  const { event, event_id: eventId, team_id: teamId } = parsed.data;
  if (event.user !== settings.allowedUserId || event.user === identity.userId || teamId !== identity.teamId
    || event.item.channel !== settings.channelId || !isCheckReaction(event.reaction)
    || (event.item_user !== undefined && event.item_user !== identity.userId)) return null;
  return { eventId, teamId, userId: event.user, channelId: event.item.channel, ts: event.item.ts, reaction: event.reaction };
}

/**
 * Someone opened the app's Home tab. `allowed` is false for anyone but the configured user: they
 * still get a view, but only the "private" one. Null for a bot, another workspace, or another tab.
 */
export function slackHomeOpened(body: unknown, settings: SlackSettings, identity: SlackIdentity) {
  const parsed = HomeOpenedSchema.safeParse(body);
  if (!parsed.success || !slackIdentityAllowed(settings, identity)) return null;
  const { event, event_id: eventId, team_id: teamId } = parsed.data;
  if (event.tab !== "home" || teamId !== identity.teamId || event.user === identity.userId) return null;
  return { eventId, teamId, userId: event.user, allowed: event.user === settings.allowedUserId };
}

type ParsedInteraction = NonNullable<ReturnType<typeof allowedSlackInteraction>>;
/** `surface` is "home" for an App Home click, where there is no message: `ts` is then empty. Absent means a message. */
export type SlackInteraction = Omit<ParsedInteraction, "surface"> & { surface?: ParsedInteraction["surface"]; deviceId?: string; profile?: string; threadTs?: string; triggerId?: string; revisionToken?: string; revisionText?: string; blockId?: string; selectedUserId?: string; stateValues?: Record<string, Record<string, unknown>> };
export type SlackReaction = NonNullable<ReturnType<typeof allowedSlackReaction>>;
export type SlackHomeOpened = NonNullable<ReturnType<typeof slackHomeOpened>>;
export type SlackIncomingMessage = NonNullable<ReturnType<typeof allowedSlackMessage>>;
