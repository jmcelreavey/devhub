import type { GatewayClient } from "@/lib/integrations/slack/gateway-client";
import type { SlackMessage, SlackMessageUpdate, SlackReceipt } from "@/lib/integrations/slack/client";
import type { ToolConfirmStore } from "@/lib/integrations/slack/tool-confirm-store";
import type { TeamDependencies } from "./dependencies";
import type { TeamAudience, TeamStore } from "./store";
export interface TeamEnvironment {
  client: GatewayClient;
  audience: () => TeamAudience;
  channel: string;
  ownerName: string;
  store: TeamStore;
  confirms: ToolConfirmStore;
  deps: TeamDependencies;
  post: (message: SlackMessage) => Promise<SlackReceipt>;
  update: (message: SlackMessageUpdate) => Promise<void>;
  active: () => boolean;
}
export function assertTeamActive(env: TeamEnvironment): void {
  if (!env.active()) throw new Error("Team Slack is offline. Reconnect before trying again.");
}

