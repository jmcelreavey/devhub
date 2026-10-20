import { record, HANDOFF_PICKUP_ACTION, HANDOFF_DECLINE_ACTION, type GatewayEnvelope, type GatewayMember } from "@shared/slack-gateway/protocol";
import type { SlackInteraction } from "@/lib/integrations/slack/security";
import { slackTextMessage } from "@/lib/integrations/slack/format";
import { SlackThreadStore } from "@/lib/integrations/slack/thread-store";
import { SlackTaskMessageStore } from "@/lib/integrations/slack/task-messages";
import { TeamAsks } from "./ask-teammate";
import { TeamHandoffs } from "./team-handoff";
import { assertTeamActive, type TeamEnvironment } from "./environment";

export class TeamCollaboration {
  readonly asks: TeamAsks;
  readonly handoffs: TeamHandoffs;
  private membersCache?: { at: number; members: GatewayMember[] };
  constructor(readonly env: TeamEnvironment) {
    this.asks = new TeamAsks(env);
    this.handoffs = new TeamHandoffs(env);
  }
  async members(): Promise<GatewayMember[]> {
    assertTeamActive(this.env);
    if (this.membersCache && this.membersCache.at + 30_000 > this.env.store.now()) return this.membersCache.members;
    const members = await this.env.client.listMembers();
    this.membersCache = { at: this.env.store.now(), members };
    return members;
  }
  async member(nameOrId: string): Promise<GatewayMember> {
    const name = nameOrId.replace(/^@/, "").toLowerCase();
    const members = (await this.members()).filter((member) => member.userId === nameOrId || member.userName.toLowerCase() === name);
    if (members.length !== 1) throw new Error("Choose one linked teammate from the list.");
    return members[0];
  }
  async ask(taskId: string, teammate: string, channel?: string) {
    const member = await this.member(teammate);
    return this.asks.ask(taskId, member.userId, channel);
  }
  async handoff(taskId: string, teammate: string, reassignJira?: boolean, commitWip?: boolean) {
    const member = await this.member(teammate);
    return this.handoffs.prepare(taskId, member.userId, member.userName, reassignJira, commitWip);
  }
  async event(event: GatewayEnvelope): Promise<boolean> {
    if (event.kind === "helper_reply") { await this.asks.helperReply(event); return true; }
    if (event.kind === "handoff_result") {
      if (event.handoffId && event.status && event.byUserId) await this.handoffs.result({ handoffId: event.handoffId, status: event.status, byUserId: event.byUserId });
      return true;
    }
    if (!event.handoff) return false;
    const body = record(event.payload);
    const actions = Array.isArray(body.actions) ? body.actions.map(record) : [];
    if (actions[0]?.action_id === HANDOFF_PICKUP_ACTION) await this.handoffs.pickup(event);
    else if (actions[0]?.action_id === HANDOFF_DECLINE_ACTION) await this.handoffs.reconcile();
    return true;
  }
  async interact(interaction: SlackInteraction): Promise<boolean> {
    if (!interaction.action.startsWith("devhub_team_") && ![HANDOFF_PICKUP_ACTION, HANDOFF_DECLINE_ACTION].includes(interaction.action)) return false;
    const env = this.env;
    const audience = env.audience();
    if (interaction.userId !== audience.userId || interaction.teamId !== audience.teamId || interaction.deviceId !== audience.deviceId) return true;
    if (["devhub_team_channel", "devhub_team_jira", "devhub_team_edit"].includes(interaction.action)) return true;
    try {
      if (interaction.action === "devhub_team_send" || interaction.action === "devhub_team_dismiss") {
        await this.asks.send(interaction.value ?? "", undefined, interaction.action === "devhub_team_dismiss", audience, interaction.channelId);
      } else if (interaction.action === "devhub_team_confirm" || interaction.action === "devhub_team_cancel") {
        const values = Object.values(interaction.stateValues ?? {}).map((value) => record(value.devhub_team_jira));
        const selected = values.find((value) => Array.isArray(value.selected_options));
        const reassign = selected ? (selected.selected_options as unknown[]).some((value) => record(value).value === "reassign") : undefined;
        await this.handoffs.confirm(interaction.value ?? "", reassign, interaction.action === "devhub_team_cancel", audience, interaction.channelId);
      } else if (interaction.selectedUserId && interaction.blockId?.startsWith("team_task_")) {
        const taskId = interaction.blockId.slice("team_task_".length);
        const stored = Object.values(new SlackThreadStore(env.store.root).read().items).find((item) => item.taskId === taskId && item.teamId === audience.teamId && item.userId === audience.userId && item.profile === audience.profile && item.channel === interaction.channelId && (item.ts === interaction.ts || item.thread_ts === interaction.ts) && !item.resolved);
        const progress = new SlackTaskMessageStore(env.store.root).taskFor({ ...audience, channel: interaction.channelId }, interaction.channelId, interaction.ts);
        if (!stored && !(progress?.taskId === taskId && progress.profile === audience.profile)) throw new Error("That task card is no longer active. Open the task in DevHub.");
        if (interaction.action === "devhub_team_ask") {
          const selected = record(interaction.stateValues?.[interaction.blockId]?.devhub_team_channel).selected_conversation;
          await this.ask(taskId, interaction.selectedUserId, typeof selected === "string" ? selected : undefined);
          await env.post(slackTextMessage(env.channel, "Question sent."));
        } else if (interaction.action === "devhub_team_handoff") {
          await this.handoffs.postPreview(await this.handoff(taskId, interaction.selectedUserId));
        }
      }
    } catch (error) {
      await env.post(slackTextMessage(env.channel, error instanceof Error ? error.message : "Couldn't complete that action. Check the task in DevHub."));
    }
    return true;
  }
}
const globalTeam = globalThis as typeof globalThis & { devhubTeamCollaboration?: TeamCollaboration };
export function registerTeamCollaboration(service: TeamCollaboration): () => void {
  globalTeam.devhubTeamCollaboration = service;
  return () => { if (globalTeam.devhubTeamCollaboration === service) delete globalTeam.devhubTeamCollaboration; };
}
export function teamCollaboration(): TeamCollaboration | undefined { return globalTeam.devhubTeamCollaboration; }
export function requireTeamCollaboration(): TeamCollaboration {
  const service = teamCollaboration();
  if (!service) throw new Error("Link team Slack in Setup first.");
  assertTeamActive(service.env);
  return service;
}

