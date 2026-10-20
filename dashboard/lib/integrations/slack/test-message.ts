import { IntegrationError } from "../types";
import { formatSlackCard } from "./format";
import { classifySlackFailure, createSlackClient, slackErrorMessage, type SlackClient } from "./client";
import { slackIdentityAllowed } from "./security";
import { readSlackSettings, slackConfigured, slackSettingsRevision } from "./settings";
import { recordSlackTest, reserveSlackSend } from "./store";
import { slackRouteContext } from "./answers";
import { SlackTestSchema, type SlackDelivery, type SlackSettings } from "./shared";

interface TestOptions {
  settings?: SlackSettings;
  profile?: string;
  root?: string;
  createClient?: (settings: SlackSettings) => SlackClient;
  wait?: (milliseconds: number) => Promise<void>;
}

export async function sendSlackTest(input: { requestId: string; revision: string }, options: TestOptions = {}): Promise<SlackDelivery> {
  const value = SlackTestSchema.parse(input);
  const settings = options.settings ?? readSlackSettings();
  if (!slackConfigured(settings) || value.revision !== slackSettingsRevision(settings)) throw new IntegrationError("conflict", "Slack settings are missing or changed. Save and refresh them in Setup before testing.");
  const profile = options.profile ?? slackRouteContext().activeProfile;
  try {
    return await recordSlackTest(value.requestId, value.revision, profile, async () => {
      if (settings.mode === "gateway" && !options.createClient) {
        const { sendGatewaySlackTest } = await import("./runtime");
        try {
          await sendGatewaySlackTest(formatSlackCard({ title: "DevHub test", profile, href: "/setup#slack", sections: [{ items: [{ title: "Team Slack is connected.", meta: "Your DevHub replies through the gateway. Changes ask for confirmation." }] }] }, settings.channelId));
          return { state: "sent", detail: "Test sent to your Team Slack DM." };
        } catch (error) { return classifySlackFailure(error).kind === "not-sent"
          ? { state: "failed", detail: "Team Slack is offline. Open DevHub on your laptop and reconnect in Setup." }
          : { state: "unknown", detail: "Couldn't confirm the Team Slack test outcome. Check your DM before trying again." }; }
      }
      const client = (options.createClient ?? createSlackClient)(settings);
      try {
        const identity = await client.authenticate();
        if (!slackIdentityAllowed(settings, identity)) return { state: "failed", detail: "Check the workspace ID and use your own member ID, not the bot's ID." };
      } catch (error) { return { state: "failed", detail: slackErrorMessage(error) }; }
      const delay = await reserveSlackSend(options.root);
      if (delay > 0) await (options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(delay);
      try {
        await client.postMessage(formatSlackCard({
          title: "DevHub test", profile, href: "/setup#slack",
          sections: [{ items: [{ title: "Slack is connected.", meta: "Ask “what PRs do I have?” or “needs me”. Replies stay in a thread; changes ask for confirmation." }] }],
        }, settings.channelId));
        return { state: "sent", detail: "Test sent. Ask “help” in the Slack channel." };
      } catch (error) {
        return { state: "unknown", detail: `${slackErrorMessage(error)} Delivery is unknown. Check the channel; this request will not be sent again.` };
      }
    }, options.root);
  } catch (error) {
    if (error instanceof Error && error.message === "test-settings-changed") throw new IntegrationError("conflict", "This test request belongs to different Slack settings or a different profile. Refresh Setup.");
    throw new IntegrationError("unavailable", "Could not record the Slack test. Check the channel before trying a new test.");
  }
}
