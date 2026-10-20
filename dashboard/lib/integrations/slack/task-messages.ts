import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeAtomic } from "@/lib/atomic-write";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import type { SlackTaskRef } from "./client";
import { readStateFile } from "./state-file";
import { slackStateRoot } from "./store";
import type { SlackAudience } from "./thread-store";

const timestamp = z.string().regex(/^\d+\.\d+$/);
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 500;
const MAX_MILESTONES = 1000;

const RefSchema = z.object({ profile: z.string(), taskId: z.string(), date: z.string().optional(), title: z.string() });
const StateSchema = z.object({
  version: z.literal(1),
  /** `<channel>:<ts>` of a message the bot posted -> the task it is about, and the thread to reply in. */
  messages: z.record(z.string(), z.object({
    ref: RefSchema, threadTs: timestamp, teamId: z.string(), userId: z.string(), at: z.number(),
  })).default({}),
  /** `<profile>:<taskId>` -> the thread root made for that task's progress messages. */
  threads: z.record(z.string(), z.object({ channel: z.string(), ts: timestamp, teamId: z.string().optional(), userId: z.string().optional(), at: z.number() })).default({}),
  /** Agent milestones already announced, by (task, run, milestone). */
  milestones: z.record(z.string(), z.number()).default({}),
  /** Set after the first progress pass, which only records what is already there. */
  seeded: z.boolean().default(false),
});
type State = z.infer<typeof StateSchema>;

export type SlackMessageTask = SlackTaskRef & { threadTs: string };

function messageKey(channel: string, ts: string): string { return `${channel}:${ts}`; }
function threadKey(profile: string, taskId: string): string { return `${profile}:${taskId}`; }

function newest<Value>(record: Record<string, Value>, limit: number, at: (value: Value) => number): Record<string, Value> {
  const entries = Object.entries(record);
  if (entries.length <= limit) return record;
  return Object.fromEntries(entries.sort((a, b) => at(b[1]) - at(a[1])).slice(0, limit));
}

/**
 * Which task a bot message is about, which thread a task's progress goes to, and which agent
 * milestones were already announced. Bounded and expiring, so it never grows with use.
 */
export class SlackTaskMessageStore {
  constructor(readonly root = slackStateRoot(), private readonly now: () => number = Date.now) {}

  private read(): State {
    return readStateFile(path.join(this.root, "task-messages.json"), (value) => StateSchema.parse(value), () => ({ version: 1, messages: {}, threads: {}, milestones: {}, seeded: false }), this.now);
  }

  private async change<Result>(update: (state: State) => Result): Promise<Result> {
    return withPluginMutationLock(path.join(this.root, "task-messages"), async () => {
      const state = this.read();
      const cutoff = this.now() - MAX_AGE_MS;
      for (const [key, entry] of Object.entries(state.messages)) if (entry.at < cutoff) delete state.messages[key];
      for (const [key, entry] of Object.entries(state.threads)) if (entry.at < cutoff) delete state.threads[key];
      for (const [key, at] of Object.entries(state.milestones)) if (at < cutoff) delete state.milestones[key];
      const result = update(state);
      state.messages = newest(state.messages, MAX_MESSAGES, (entry) => entry.at);
      state.threads = newest(state.threads, MAX_MESSAGES, (entry) => entry.at);
      state.milestones = newest(state.milestones, MAX_MILESTONES, (at) => at);
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      await writeAtomic(path.join(this.root, "task-messages.json"), JSON.stringify(StateSchema.parse(state)));
      fs.chmodSync(path.join(this.root, "task-messages.json"), 0o600);
      return result;
    });
  }

  /** Remembers a message the bot just posted about a task. `threadTs` is the thread a reply to it belongs in. */
  remember(audience: SlackAudience, channel: string, ts: string, ref: SlackTaskRef, threadTs: string): Promise<void> {
    return this.change((state) => {
      state.messages[messageKey(channel, ts)] = { ref: { profile: ref.profile, taskId: ref.taskId, date: ref.date, title: ref.title }, threadTs, teamId: audience.teamId, userId: audience.userId, at: this.now() };
      const key = threadKey(ref.profile, ref.taskId);
      const previous = state.threads[key];
      if (!previous || previous.teamId !== audience.teamId || previous.userId !== audience.userId || previous.channel !== channel) {
        state.threads[key] = { ...audience, channel, ts: threadTs, at: this.now() };
      }
    });
  }

  /** The task a message in this audience's channel is about, if the bot recorded one. */
  taskFor(audience: SlackAudience, channel: string, ts: string): SlackMessageTask | undefined {
    const entry = this.read().messages[messageKey(channel, ts)];
    if (!entry || entry.at < this.now() - MAX_AGE_MS || entry.teamId !== audience.teamId || entry.userId !== audience.userId || channel !== audience.channel) return undefined;
    return { ...entry.ref, threadTs: entry.threadTs };
  }

  /** The thread root made for a task's progress messages, if any. */
  threadFor(audience: SlackAudience, profile: string, taskId: string): { channel: string; ts: string } | undefined {
    const entry = this.read().threads[threadKey(profile, taskId)];
    return entry && entry.at >= this.now() - MAX_AGE_MS && entry.teamId === audience.teamId && entry.userId === audience.userId && entry.channel === audience.channel
      ? { channel: entry.channel, ts: entry.ts } : undefined;
  }

  /** Records a new thread root for a task, and the root message as one a ✅ can act on. */
  rememberThread(audience: SlackAudience, channel: string, ts: string, ref: SlackTaskRef): Promise<void> {
    return this.change((state) => {
      state.threads[threadKey(ref.profile, ref.taskId)] = { ...audience, channel, ts, at: this.now() };
      state.messages[messageKey(channel, ts)] = { ref: { profile: ref.profile, taskId: ref.taskId, date: ref.date, title: ref.title }, threadTs: ts, teamId: audience.teamId, userId: audience.userId, at: this.now() };
    });
  }

  /** True if the milestone was announced (or deliberately skipped) before. */
  announced(key: string): boolean { return key in this.read().milestones; }

  /**
   * Takes the milestone for this caller: true only the first time. Taken before the post goes out, so
   * an uncertain outcome is never announced twice; `release` hands it back after a failure that
   * provably sent nothing.
   */
  claimMilestone(key: string): Promise<boolean> {
    return this.change((state) => {
      if (key in state.milestones) return false;
      state.milestones[key] = this.now();
      return true;
    });
  }

  releaseMilestone(key: string): Promise<void> {
    return this.change((state) => { delete state.milestones[key]; });
  }

  /** Marks milestones as already known without announcing them (first run, or progress posts switched off). */
  async markAnnounced(keys: readonly string[]): Promise<void> {
    const fresh = keys.filter((key) => !this.announced(key));
    if (!fresh.length) return;
    await this.change((state) => { for (const key of fresh) state.milestones[key] ??= this.now(); });
  }

  /** True once the first progress pass has run, so a fresh install doesn't announce old runs. */
  seeded(): boolean { return this.read().seeded; }

  async markSeeded(): Promise<void> { await this.change((state) => { state.seeded = true; }); }
}
