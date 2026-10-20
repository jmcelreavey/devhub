import type { SlackMessage, SlackReceipt } from "./client";
import { SlackTaskMessageStore } from "./task-messages";
import { sameSlackAudience, SlackThreadStore, type SlackAudience } from "./thread-store";

/** The task a ✅ reaction landed on, and the thread to answer in. */
export interface SlackReactionTarget { profile: string; taskId: string; threadTs: string }

/**
 * Which task a bot message is about. Needs-you cards and their thread roots come from the thread
 * store; task cards, add-task replies and progress thread roots come from the task-message store.
 * A message neither knows (or a digest that covers several tasks) maps to nothing.
 */
export interface SlackTaskDirectory {
  resolve: (audience: SlackAudience, channel: string, ts: string) => SlackReactionTarget | undefined;
  /** Records a message the bot just posted about a task, once Slack has given it a timestamp. */
  remember: (audience: SlackAudience, receipt: SlackReceipt, message: SlackMessage) => Promise<void>;
}

export function createTaskDirectory(threads: SlackThreadStore = new SlackThreadStore(), messages: SlackTaskMessageStore = new SlackTaskMessageStore()): SlackTaskDirectory {
  return {
    resolve(audience, channel, ts) {
      if (channel !== audience.channel) return undefined;
      const matches = Object.values(threads.read().items).filter((item) => item.taskId && sameSlackAudience(item, audience) && (item.ts === ts || item.thread_ts === ts));
      const tasks = new Map(matches.map((item) => [`${item.profile}:${item.taskId}`, item]));
      if (tasks.size > 1) return undefined;
      const [found] = tasks.values();
      if (found) return { profile: found.profile, taskId: found.taskId!, threadTs: found.thread_ts ?? ts };
      const known = messages.taskFor(audience, channel, ts);
      return known ? { profile: known.profile, taskId: known.taskId, threadTs: known.threadTs } : undefined;
    },
    async remember(audience, receipt, message) {
      if (!message.taskRef) return;
      try { await messages.remember(audience, receipt.channel, receipt.ts, message.taskRef, message.thread_ts ?? receipt.ts); }
      catch { console.warn("[slack] Could not record which task a message is about."); }
    },
  };
}
