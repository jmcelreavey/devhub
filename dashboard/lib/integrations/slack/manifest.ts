export function buildSlackManifest() {
  return {
    display_information: { name: "DevHub", description: "Task questions and answers from DevHub", background_color: "#252525" },
    features: {
      bot_user: { display_name: "DevHub", always_online: false },
      // The Home tab is the live Needs-you dashboard. The Messages tab stays on so a DM to the bot still works.
      app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    },
    // reactions:read is what lets a ✅ on a card check its task off. Apps made before it was added must be reinstalled to get it.
    oauth_config: { scopes: { bot: ["chat:write", "channels:history", "groups:history", "im:history", "app_mentions:read", "reactions:read"] } },
    settings: {
      socket_mode_enabled: true,
      interactivity: { is_enabled: true },
      event_subscriptions: { bot_events: ["message.channels", "message.groups", "message.im", "app_mention", "reaction_added", "app_home_opened"] },
    },
  };
}

export function slackAppCreationUrl(): string {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(buildSlackManifest()))}`;
}
