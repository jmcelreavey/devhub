import { classifySlackFailure, type SlackMessage } from "./client";
import { teamTaskActions } from "@/lib/team/cards";
import type { SlackMilestone } from "./milestones";
import { formatSlackProgress, formatSlackTaskRoot } from "./needs-you-format";
import type { SlackNeedsTransport } from "./needs-you";
import type { SlackTaskMessageStore } from "./task-messages";
import { sameSlackAudience, type SlackAudience, type SlackThreadItem } from "./thread-store";

/** A burst of finished runs is spread over a few ticks instead of one wall of messages. */
const MAX_PER_TICK = 3;

export interface SlackProgressOptions {
  /** The "Post agent progress" switch in Setup. Off means milestones are noted as seen and nothing is posted. */
  enabled: boolean;
  /** Quiet hours for the profile: hold everything until they end. */
  quiet: boolean;
  baseline?: boolean;
  needsEnabled?: boolean;
  items: () => SlackThreadItem[];
}

/**
 * Posts one short message into a task's Slack thread when its agent run reaches a milestone. The
 * milestones come from the board the Needs-you tick has already read, so this adds no polling.
 * It runs inside that tick, so the scheduler guard and process lock apply unchanged.
 */
export class SlackProgress {
  constructor(
    private readonly audience: SlackAudience,
    private readonly transport: SlackNeedsTransport,
    private readonly messages: SlackTaskMessageStore,
  ) {}

  async run(milestones: readonly SlackMilestone[], options: SlackProgressOptions): Promise<void> {
    const keys = milestones.map((milestone) => milestone.key);
    // First run ever, or progress posts switched off: learn what is already there, announce none of it.
    if (!this.messages.seeded() || !options.enabled || options.baseline) {
      await this.messages.markAnnounced(keys);
      if (!this.messages.seeded()) await this.messages.markSeeded();
      return;
    }
    if (options.quiet) return;
    const fresh = milestones.filter((milestone) => !this.messages.announced(milestone.key));
    let posted = 0;
    for (const milestone of fresh) {
      if (posted >= MAX_PER_TICK) break;
      // A waiting state that already has its own Needs-you card in this thread is announced by that card.
      if (options.needsEnabled !== false && (this.cardCovers(milestone, options.items()) || this.hasNeedCard(milestone, options.items()))) { await this.messages.markAnnounced([milestone.key]); continue; }
      if (!await this.messages.claimMilestone(milestone.key)) continue;
      posted++;
      try { await this.announce(milestone, options.items()); }
      catch (error) {
        // Only a failure that provably sent nothing is tried again; an unknown outcome is never repeated.
        if (classifySlackFailure(error).kind !== "uncertain") await this.messages.releaseMilestone(milestone.key);
        throw error;
      }
    }
  }

  /** Only waiting states: a live card for the task already carries the question or the "Plan ready" status, so a second message would repeat it, vaguer. */
  private cardCovers(milestone: SlackMilestone, items: SlackThreadItem[]): boolean {
    if (milestone.kind !== "needs-input" && milestone.kind !== "plan-ready") return false;
    return items.some((item) => sameSlackAudience(item, this.audience) && item.profile === milestone.profile && item.taskId === milestone.taskId
      && !item.resolved && item.delivery === "sent" && (milestone.kind === "needs-input" || /^plan ready/i.test(item.needed)));
  }

  private hasNeedCard(milestone: SlackMilestone, items: SlackThreadItem[]): boolean {
    return items.some((item) => sameSlackAudience(item, this.audience) && item.profile === milestone.profile && item.taskId === milestone.taskId
      && !item.resolved && (milestone.kind === "needs-input" && (item.action === "answer" || item.action === "repo")
        || milestone.kind === "plan-ready" && item.state === "plan-ready"
        || milestone.kind === "failed" && (item.state === "failed-run" || item.state === "push-failed" || item.action === "retry")));
  }

  /** The task's existing thread (a Needs-you card first), else a new root card that is remembered. */
  private async threadFor(milestone: SlackMilestone, items: SlackThreadItem[]): Promise<string> {
    const forTask = items.filter((item) => sameSlackAudience(item, this.audience) && item.profile === milestone.profile && item.taskId === milestone.taskId && item.thread_ts);
    const existing = (forTask.find((item) => !item.resolved) ?? forTask[0])?.thread_ts ?? this.rememberedThread(milestone);
    if (existing) return existing;
    const receipt = await this.transport.post(this.taskMessage(formatSlackTaskRoot(milestone, this.audience.channel), milestone));
    await this.messages.rememberThread(this.audience, receipt.channel, receipt.ts, { profile: milestone.profile, taskId: milestone.taskId, title: milestone.title });
    return receipt.ts;
  }

  private rememberedThread(milestone: SlackMilestone): string | undefined {
    const known = this.messages.threadFor(this.audience, milestone.profile, milestone.taskId);
    return known?.channel === this.audience.channel ? known.ts : undefined;
  }

  private async announce(milestone: SlackMilestone, items: SlackThreadItem[]): Promise<void> {
    const threadTs = await this.threadFor(milestone, items);
    await this.transport.post(this.taskMessage(formatSlackProgress(milestone, this.audience.channel, threadTs), milestone));
  }
  private taskMessage(message: SlackMessage, milestone: SlackMilestone): SlackMessage {
    if (!this.audience.deviceId) return message;
    return { ...message, taskRef: { taskId: milestone.taskId, profile: milestone.profile, title: milestone.title }, blocks: [...(message.blocks ?? []), ...teamTaskActions(milestone.taskId)] };
  }
}
