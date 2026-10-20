import fs from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { slackLayer } from "./slack.ts";

const web = vi.hoisted(() => ({
  auth: { test: vi.fn() }, users: { info: vi.fn() },
  conversations: { open: vi.fn(), members: vi.fn() },
  chat: { postMessage: vi.fn(), update: vi.fn(), postEphemeral: vi.fn() },
}));
vi.mock("@slack/web-api", () => ({ WebClient: vi.fn(function () { return web; }) }));
beforeEach(() => { vi.resetAllMocks(); web.auth.test.mockResolvedValue({ user_id: "UBOT", team_id: "T1" }); });

it("opens a group DM with owner and helper, leaving the bot implicit", async () => {
  web.conversations.open.mockResolvedValue({ channel: { id: "GDM" } });
  const slack = await slackLayer("fake-token");
  expect(await slack.openGroupDm!("U1", "U2")).toBe("GDM");
  expect(web.conversations.open).toHaveBeenCalledWith({ users: "U1,U2" });
});

it("paginates membership and caches each channel/owner pair for no more than five minutes", async () => {
  let now = 100; const slack = await slackLayer("fake-token", () => now);
  web.conversations.members.mockResolvedValueOnce({ members: ["U3"], response_metadata: { next_cursor: "next" } })
    .mockResolvedValueOnce({ members: ["U1"], response_metadata: { next_cursor: "" } });
  expect(await slack.isChannelMember!("C1", "U1")).toBe(true);
  expect(web.conversations.members.mock.calls).toEqual([[{ channel: "C1", cursor: undefined, limit: 200 }], [{ channel: "C1", cursor: "next", limit: 200 }]]);
  now += 5 * 60_000 - 1;
  expect(await slack.isChannelMember!("C1", "U1")).toBe(true); expect(web.conversations.members).toHaveBeenCalledTimes(2);
  now++;
  web.conversations.members.mockResolvedValue({ members: ["U3"] });
  expect(await slack.isChannelMember!("C1", "U1")).toBe(false);
  expect(await slack.isChannelMember!("C1", "U2")).toBe(false);
  expect(await slack.isChannelMember!("G1", "U1")).toBe(false);
  expect(web.conversations.members).toHaveBeenCalledTimes(5);
});

it("fails closed on missing pages, repeated cursors and Slack membership errors", async () => {
  const slack = await slackLayer("fake-token");
  web.conversations.members.mockResolvedValueOnce({});
  await expect(slack.isChannelMember!("C1", "U1")).rejects.toThrow("membership missing");
  web.conversations.members.mockResolvedValue({ members: ["U3"], response_metadata: { next_cursor: "same" } });
  await expect(slack.isChannelMember!("C1", "U1")).rejects.toThrow("cursor repeated");
  web.conversations.members.mockRejectedValue(new Error("not_in_channel"));
  await expect(slack.isChannelMember!("C1", "U1")).rejects.toThrow("not_in_channel");
  web.conversations.members.mockResolvedValue({ members: ["U1"] });
  expect(await slack.isChannelMember!("C1", "U1")).toBe(true);
});

it("fails closed if a group DM has no Slack channel receipt", async () => {
  web.conversations.open.mockResolvedValue({});
  const slack = await slackLayer("fake-token");
  await expect(slack.openGroupDm!("U1", "U2")).rejects.toThrow("group DM");
});

it("clears terminal card blocks without retaining the original bundle", async () => {
  const slack = await slackLayer("fake-token");
  await slack.execute({ kind: "update", channel: "D2", ts: "1.000", text: "Expired", blocks: [] });
  expect(web.chat.update).toHaveBeenCalledWith({ channel: "D2", ts: "1.000", text: "Expired", blocks: [], parse: "none" });
});

it("declares only the required additional team scopes and MPIM event", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  expect(manifest.oauth_config.scopes.bot).toEqual(["chat:write", "commands", "users:read", "im:write", "channels:history", "groups:history", "im:history", "app_mentions:read", "reactions:read", "reactions:write", "mpim:write", "mpim:history", "channels:read", "groups:read"]);
  expect(manifest.settings.event_subscriptions.bot_events).toEqual(["message.channels", "message.groups", "message.im", "app_mention", "reaction_added", "app_home_opened", "message.mpim"]);
});
