import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { writeAtomic } from "@/lib/atomic-write";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { readStateFile } from "./state-file";
import { slackStateRoot } from "./store";
import { slackNeedKey, type SlackNeed } from "./needs-you-source";

const timestamp = z.string().regex(/^\d+\.\d+$/);
const ItemSchema = z.object({
  profile: z.string(), entityId: z.string(), taskId: z.string().optional(), jiraKey: z.string().optional(), questionId: z.string().optional(),
  itemKey: z.string(), title: z.string(), needed: z.string(), href: z.string(), action: z.enum(["answer", "repo", "retry", "open", "approve-plan"]),
  state: z.enum(["plan-ready", "question", "failed-run", "review-ready", "finished-feedback", "push-failed"]).optional(),
  options: z.array(z.string().min(1).max(120)).max(6).optional(),
  plan: z.object({ runId: z.string(), fingerprint: z.string(), summary: z.string() }).optional(),
  planDecision: z.enum(["claimed", "approved", "revised"]).optional(),
  revision: z.object({ token: z.string(), expiresAt: z.number(), mode: z.enum(["modal", "thread"]) }).optional(),
  prRows: z.array(z.object({ title: z.string(), href: z.string(), needed: z.string(), itemKey: z.string().optional() })).optional(),
  teamId: z.string(), userId: z.string(), channel: z.string(),
  thread_ts: timestamp.optional(), ts: timestamp.optional(), digestTs: timestamp.optional(),
  postedAt: z.string().datetime(), resolved: z.boolean(), resolution: z.string().optional(),
  delivery: z.enum(["skipped", "sending", "sent", "unknown"]), dirty: z.boolean().default(false),
});
const ConfirmationSchema = z.object({
  itemId: z.string(), teamId: z.string(), userId: z.string(), channel: z.string(), thread_ts: timestamp.optional(),
  ts: timestamp.optional(), expiresAt: z.number(), state: z.enum(["pending", "consumed", "cancelled"]),
  deviceId: z.string().optional(), argsHash: z.string().optional(), nonce: z.string().optional(),
  kind: z.literal("answer").optional(), questionId: z.string().optional(), questionText: z.string().optional(), answer: z.string().max(12000).optional(),
});
const StateSchema = z.object({
  version: z.literal(1), items: z.record(z.string(), ItemSchema), confirmations: z.record(z.string(), ConfirmationSchema),
});

export interface SlackAudience { teamId: string; userId: string; channel: string; deviceId?: string }
export type SlackThreadItem = z.infer<typeof ItemSchema>;
export type SlackConfirmation = z.infer<typeof ConfirmationSchema>;
export type SlackThreadState = z.infer<typeof StateSchema>;

export function sameSlackAudience(item: SlackAudience, audience: SlackAudience): boolean {
  return item.teamId === audience.teamId && item.userId === audience.userId && item.channel === audience.channel;
}

export function slackThreadItemId(item: SlackNeed, audience: SlackAudience): string {
  return createHash("sha256").update(JSON.stringify([audience.teamId, audience.channel, audience.userId, slackNeedKey(item)])).digest("hex");
}

export class SlackThreadStore {
  private reset = false;
  constructor(readonly root = slackStateRoot()) {}

  read(): SlackThreadState {
    return readStateFile(path.join(this.root, "threads.json"), (value) => StateSchema.parse(value), () => ({ version: 1, items: {}, confirmations: {} }), Date.now, () => { this.reset = true; });
  }

  /** True once after a corrupt file was set aside: what was already posted is no longer known. */
  wasReset(): boolean {
    const was = this.reset;
    this.reset = false;
    return was;
  }

  async change<Result>(update: (state: SlackThreadState) => Result): Promise<Result> {
    return withPluginMutationLock(path.join(this.root, "threads"), async () => {
      const state = this.read();
      const result = update(state);
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      await writeAtomic(path.join(this.root, "threads.json"), JSON.stringify(StateSchema.parse(state)));
      fs.chmodSync(path.join(this.root, "threads.json"), 0o600);
      return result;
    });
  }
}
