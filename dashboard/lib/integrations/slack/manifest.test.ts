import { describe, expect, it } from "vitest";
import { buildSlackManifest, slackAppCreationUrl } from "./manifest";

describe("Slack app manifest", () => {
  it("opens app creation with a URL-encoded, valid JSON manifest", () => {
    const url = new URL(slackAppCreationUrl());
    expect(url.origin + url.pathname).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(url.searchParams.get("manifest_json")!)).toEqual(buildSlackManifest());
    expect(slackAppCreationUrl()).toContain("%7B");
  });
  it("enables Socket Mode and interactivity without public request URLs", () => {
    expect(buildSlackManifest().settings).toMatchObject({ socket_mode_enabled: true, interactivity: { is_enabled: true } });
    expect(JSON.stringify(buildSlackManifest())).not.toMatch(/request_url|xoxb-|xapp-/);
  });
  it("requests only the scopes and events the bot uses", () => {
    const manifest = buildSlackManifest();
    expect(manifest.oauth_config.scopes.bot).toEqual(["chat:write", "channels:history", "groups:history", "im:history", "app_mentions:read", "reactions:read"]);
    expect(manifest.settings.event_subscriptions.bot_events).toEqual(["message.channels", "message.groups", "message.im", "app_mention", "reaction_added", "app_home_opened"]);
  });
  it("adds only reaction_added: a removed ✅ never undoes anything, so reaction_removed is not subscribed", () => {
    expect(buildSlackManifest().settings.event_subscriptions.bot_events).not.toContain("reaction_removed");
  });
  it("turns the Home tab on and keeps DMs working", () => {
    expect(buildSlackManifest().features.app_home).toEqual({ home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false });
  });
});
