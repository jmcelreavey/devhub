import { describe, expect, it } from "vitest";
import { allowedSlackInteraction, allowedSlackMessage, allowedSlackReaction, isCheckReaction, slackHomeOpened, slackIdentityAllowed } from "./security";

const settings = { botToken: "xoxb-test", appToken: "xapp-test", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM" };
const identity = { userId: "UBOT", name: "DevHub", teamId: "TTEAM" };
const body = { team_id: "TTEAM", event_id: "Ev123", event: { type: "message", user: "UOWNER", channel: "CCHANNEL", text: "help", ts: "123.456" } };
const interaction = {
  type: "block_actions", team: { id: "TTEAM" }, user: { id: "UOWNER" }, channel: { id: "CCHANNEL" },
  container: { type: "message", channel_id: "CCHANNEL", message_ts: "123.456" }, message: { ts: "123.456" },
  actions: [{ type: "button", action_id: "devhub_confirm_retry", action_ts: "123.457", value: "token" }],
};

describe("Slack allowlist", () => {
  it("accepts only the six option buttons from the configured owner", () => {
    const click = (index: number) => ({ ...interaction, actions: [{ ...interaction.actions[0], action_id: `devhub_answer_option_${index}` }] });
    for (let index = 0; index < 6; index++) {
      expect(allowedSlackInteraction(click(index), settings, identity)?.action).toBe(`devhub_answer_option_${index}`);
    }
    expect(allowedSlackInteraction(click(6), settings, identity)).toBeNull();
    expect(allowedSlackInteraction({ ...click(0), user: { id: "UOTHER" } }, settings, identity)).toBeNull();
  });

  it.each(["devhub_approve_plan", "devhub_revise_plan"])("allowlists %s only for the configured owner and preserves the trigger", (action) => {
    const body = { ...interaction, trigger_id: "trigger-one", actions: [{ ...interaction.actions[0], action_id: action, value: "a".repeat(64) }] };
    expect(allowedSlackInteraction(body, settings, identity)).toMatchObject({ action, triggerId: "trigger-one" });
    expect(allowedSlackInteraction({ ...body, user: { id: "UOTHER" } }, settings, identity)).toBeNull();
    expect(allowedSlackInteraction({ ...body, channel: { id: "COTHER" } }, settings, identity)).toBeNull();
  });
  const revision = { type: "view_submission", team: { id: "TTEAM" }, user: { id: "UOWNER" }, view: { id: "VREVISION", callback_id: "devhub_submit_plan_revision", private_metadata: `${"a".repeat(64)}:11111111-1111-4111-8111-111111111111`, state: { values: { plan_revision: { guidance: { type: "plain_text_input", value: "Keep reads local.\nPreserve retries." } } } } } };
  it("parses only owner plan-revision modal submissions with bounded text and metadata", () => {
    expect(allowedSlackInteraction(revision, settings, identity)).toMatchObject({ surface: "modal", action: "devhub_submit_plan_revision", value: "a".repeat(64), revisionToken: "11111111-1111-4111-8111-111111111111", revisionText: "Keep reads local.\nPreserve retries." });
    for (const change of [{ user: { id: "UOTHER" } }, { team: { id: "TOTHER" } }, { view: { ...revision.view, private_metadata: "tampered" } }, { view: { ...revision.view, callback_id: "unknown_callback" } }]) {
      expect(allowedSlackInteraction({ ...revision, ...change }, settings, identity)).toBeNull();
    }
    expect(allowedSlackInteraction(revision, { ...settings, mode: "gateway" }, identity)).toBeNull();
    for (const value of ["", "  ", "x".repeat(3001), "x".repeat(4001)]) {
      expect(allowedSlackInteraction({ ...revision, view: { ...revision.view, state: { values: { plan_revision: { guidance: { type: "plain_text_input", value } } } } } }, settings, identity)).toBeNull();
    }
  });
  it("accepts only the configured user in the configured channel and authenticated team", () => {
    expect(allowedSlackMessage(body, settings, identity)).toMatchObject({ text: "help", teamId: "TTEAM", userId: "UOWNER" });
    expect(allowedSlackMessage({ ...body, event: { ...body.event, type: "app_mention" } }, settings, identity)).not.toBeNull();
  });
  it.each([{ user: "UOTHER" }, { channel: "COTHER" }, { user: "UBOT" }, { bot_id: "BBOT" }, { bot_profile: {} }, { subtype: "message_changed" }, { subtype: "bot_message" }, { hidden: true }, { team: "TOTHER" }])("silently ignores untrusted and bot events: %j", (patch) => {
    expect(allowedSlackMessage({ ...body, event: { ...body.event, ...patch } }, settings, identity)).toBeNull();
  });
  it.each(["TOTHER", ""])("rejects a different or missing workspace: %s", (team) => {
    expect(allowedSlackMessage({ ...body, team_id: team }, settings, identity)).toBeNull();
  });
  it("pins the workspace to auth.test even when the optional workspace setting is blank", () => {
    expect(allowedSlackMessage(body, { ...settings, teamId: "" }, identity)).not.toBeNull();
    expect(allowedSlackMessage({ ...body, team_id: "TOTHER" }, { ...settings, teamId: "" }, identity)).toBeNull();
  });
  it("never treats the bot's auth.test user ID as the human allowlist", () => {
    expect(slackIdentityAllowed({ ...settings, allowedUserId: identity.userId }, identity)).toBe(false);
    expect(slackIdentityAllowed({ ...settings, teamId: "TOTHER" }, identity)).toBe(false);
  });
  it.each([null, {}, { ...body, event: { ...body.event, type: "reaction_added" } }, { ...body, event: { ...body.event, ts: "bad" } }])("ignores malformed or unrelated input", (input) => {
    expect(allowedSlackMessage(input, settings, identity)).toBeNull();
  });
  it("pins button interactions to the human, authenticated workspace, channel and source message", () => {
    expect(allowedSlackInteraction(interaction, settings, identity)).toMatchObject({ action: "devhub_confirm_retry", value: "token" });
    for (const change of [{ user: { id: "UOTHER" } }, { user: { id: "UBOT" } }, { team: { id: "TOTHER" } }, { channel: { id: "COTHER" } }, { container: { ...interaction.container, channel_id: "COTHER" } }, { message: { ts: "999.9" } }, { actions: [] }, { type: "view_submission" }]) {
      expect(allowedSlackInteraction({ ...interaction, ...change }, settings, identity)).toBeNull();
    }
    expect(allowedSlackInteraction(interaction, { ...settings, teamId: "" }, identity)).not.toBeNull();
    expect(allowedSlackInteraction(interaction, { ...settings, allowedUserId: "UBOT" }, identity)).toBeNull();
  });
  it.each(["devhub_tool_confirm", "devhub_tool_cancel", "devhub_tool_undo", "devhub_tool_view", "devhub_need_plan", "devhub_need_implement", "devhub_tool_pick_1", "devhub_tool_pick_3"])("accepts the tool button %s only from the allowed user and message", (action) => {
    const body = { ...interaction, actions: [{ ...interaction.actions[0], action_id: action, value: "abc" }] };
    expect(allowedSlackInteraction(body, settings, identity)).toMatchObject({ action, value: "abc", userId: settings.allowedUserId });
    expect(allowedSlackInteraction({ ...body, user: { id: "UOTHER" } }, settings, identity)).toBeNull();
    expect(allowedSlackInteraction({ ...body, message: { ts: "999.9" } }, settings, identity)).toBeNull();
  });
  it("accepts five pick buttons (one per matching task) and nothing past them", () => {
    for (const n of [4, 5]) expect(allowedSlackInteraction({ ...interaction, actions: [{ ...interaction.actions[0], action_id: `devhub_tool_pick_${n}` }] }, settings, identity)?.action).toBe(`devhub_tool_pick_${n}`);
    expect(allowedSlackInteraction({ ...interaction, actions: [{ ...interaction.actions[0], action_id: "devhub_tool_pick_6" }] }, settings, identity)).toBeNull();
  });
  it("accepts the five choice buttons and nothing past them", () => {
    expect(allowedSlackInteraction({ ...interaction, actions: [{ ...interaction.actions[0], action_id: "devhub_tool_choose_5" }] }, settings, identity)?.action).toBe("devhub_tool_choose_5");
    expect(allowedSlackInteraction({ ...interaction, actions: [{ ...interaction.actions[0], action_id: "devhub_tool_choose_6" }] }, settings, identity)).toBeNull();
  });
});

const reaction = { team_id: "TTEAM", event_id: "Ev9", event: { type: "reaction_added", user: "UOWNER", reaction: "white_check_mark", item: { type: "message", channel: "CCHANNEL", ts: "123.456" }, item_user: "UBOT" } };

describe("Slack reactions", () => {
  it.each(["white_check_mark", "heavy_check_mark", "ballot_box_with_check", "white_check_mark::skin-tone-3"])("accepts %s from the allowed user on a bot message in the pinned channel", (name) => {
    expect(allowedSlackReaction({ ...reaction, event: { ...reaction.event, reaction: name } }, settings, identity)).toMatchObject({ channelId: "CCHANNEL", ts: "123.456", userId: "UOWNER", teamId: "TTEAM" });
    expect(isCheckReaction(name)).toBe(true);
  });
  it.each([{ reaction: "thumbsup" }, { reaction: "x" }, { user: "UOTHER" }, { user: "UBOT" }, { item_user: "UOTHER" }, { item: { type: "message", channel: "COTHER", ts: "123.456" } }, { item: { type: "file", channel: "CCHANNEL", ts: "123.456" } }, { item: { type: "message", channel: "CCHANNEL", ts: "bad" } }])("ignores a reaction that is not the allowed user's ✅ on a bot message: %j", (patch) => {
    expect(allowedSlackReaction({ ...reaction, event: { ...reaction.event, ...patch } }, settings, identity)).toBeNull();
  });
  it("pins the workspace and never treats reaction_removed as a check-off", () => {
    expect(allowedSlackReaction({ ...reaction, team_id: "TOTHER" }, settings, identity)).toBeNull();
    expect(allowedSlackReaction({ ...reaction, event: { ...reaction.event, type: "reaction_removed" } }, settings, identity)).toBeNull();
    expect(allowedSlackReaction(reaction, { ...settings, teamId: "TOTHER" }, identity)).toBeNull();
    expect(allowedSlackReaction(reaction, { ...settings, allowedUserId: "UBOT" }, identity)).toBeNull();
  });
});

describe("Slack App Home", () => {
  const opened = { team_id: "TTEAM", event_id: "Ev10", event: { type: "app_home_opened", user: "UOWNER", tab: "home" } };
  it("tells the allowed user from anyone else, and ignores other tabs, bots and workspaces", () => {
    expect(slackHomeOpened(opened, settings, identity)).toMatchObject({ userId: "UOWNER", allowed: true });
    expect(slackHomeOpened({ ...opened, event: { ...opened.event, user: "UOTHER" } }, settings, identity)).toMatchObject({ userId: "UOTHER", allowed: false });
    expect(slackHomeOpened({ ...opened, event: { ...opened.event, tab: "messages" } }, settings, identity)).toBeNull();
    expect(slackHomeOpened({ ...opened, event: { ...opened.event, user: "UBOT" } }, settings, identity)).toBeNull();
    expect(slackHomeOpened({ ...opened, team_id: "TOTHER" }, settings, identity)).toBeNull();
  });
  const click = {
    type: "block_actions", team: { id: "TTEAM" }, user: { id: "UOWNER" }, container: { type: "view", view_id: "V1" }, view: { type: "home" },
    actions: [{ type: "button", action_id: "devhub_need_plan", action_ts: "5.5", value: "abc" }],
  };
  it("accepts a Home click from the allowed user with no channel or message, answering in the configured channel", () => {
    expect(allowedSlackInteraction(click, settings, identity)).toMatchObject({ surface: "home", action: "devhub_need_plan", value: "abc", channelId: "CCHANNEL", userId: "UOWNER" });
    expect(allowedSlackInteraction({ ...click, actions: [{ ...click.actions[0], action_id: "devhub_home_refresh", value: undefined }] }, settings, identity)?.action).toBe("devhub_home_refresh");
    expect(allowedSlackInteraction(interaction, settings, identity)).toMatchObject({ surface: "message" });
  });
  it.each([{ user: { id: "UOTHER" } }, { team: { id: "TOTHER" } }, { view: { type: "modal" } }, { container: { type: "view" } }])("rejects a Home click that is not the allowed user's: %j", (patch) => {
    expect(allowedSlackInteraction({ ...click, ...patch }, settings, identity)).toBeNull();
  });
});
