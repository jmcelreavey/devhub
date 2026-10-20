import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeAtomic } from "@/lib/atomic-write";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { readStateFile } from "@/lib/integrations/slack/state-file";
import { slackStateRoot } from "@/lib/integrations/slack/store";

export const TEAM_TTL_MS = 24 * 60 * 60 * 1000;
const Audience = z.object({ teamId: z.string(), userId: z.string(), deviceId: z.string(), profile: z.string() });
const Ask = Audience.extend({ askId: z.string(), taskId: z.string(), question: z.string(), questionId: z.string(), questionHash: z.string(), helperUserId: z.string(), channel: z.string(), groupDm: z.boolean().default(false), ts: z.string(), createdAt: z.number(), expiresAt: z.number(), status: z.enum(["active", "answered", "expired"]) });
export const TeamBundleSchema = z.object({ version: z.literal(1), handoffId: z.string().uuid(), title: z.string().min(1).max(500), repo: z.string().min(1).max(500), branch: z.string().min(1).max(255), jiraKey: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).optional(), prUrl: z.string().url().max(1000).optional(), reassignJira: z.boolean() }).strict();
const Handoff = Audience.extend({ taskId: z.string(), handoffId: z.string(), toUserId: z.string(), toName: z.string(), createdAt: z.number().optional(), expiresAt: z.number(), status: z.enum(["pending", "accepted", "declined", "expired"]), bundle: TeamBundleSchema });
const Pickup = Audience.extend({ handoffId: z.string(), taskId: z.string(), createdAt: z.number().default(0), cwd: z.string().optional(), branch: z.string().optional(), bundle: TeamBundleSchema.optional(), imported: z.boolean().default(false), resolved: z.boolean().default(false), jiraAttempted: z.boolean().default(false), warning: z.string().optional() });
const Schema = z.object({ version: z.literal(1), asks: z.record(z.string(), Ask), handoffs: z.record(z.string(), Handoff), pickups: z.record(z.string(), Pickup) });
export type TeamAsk = z.infer<typeof Ask>;
export type TeamHandoff = z.infer<typeof Handoff>;
export type TeamPickup = z.infer<typeof Pickup>;
export type TeamBundle = z.infer<typeof TeamBundleSchema>;
export type TeamAudience = z.infer<typeof Audience>;
export type TeamState = z.infer<typeof Schema>;
export function sameTeamAudience(left: TeamAudience, right: TeamAudience): boolean {
  return left.teamId === right.teamId && left.userId === right.userId && left.deviceId === right.deviceId && left.profile === right.profile;
}
export class TeamStore {
  constructor(readonly root = slackStateRoot(), readonly now: () => number = Date.now) {}
  read(): TeamState {
    return readStateFile(path.join(this.root, "team.json"), (value) => Schema.parse(value), () => ({ version: 1, asks: {}, handoffs: {}, pickups: {} }));
  }
  async change<Result>(update: (state: TeamState) => Result): Promise<Result> {
    return withPluginMutationLock(path.join(this.root, "team-store"), async () => {
      const state = this.read();
      const retention = 7 * TEAM_TTL_MS;
      for (const ask of Object.values(state.asks)) if (ask.expiresAt <= this.now()) ask.status = "expired";
      for (const [id, ask] of Object.entries(state.asks)) if (ask.expiresAt + retention <= this.now()) delete state.asks[id];
      for (const [id, handoff] of Object.entries(state.handoffs)) if (handoff.status !== "pending" && handoff.expiresAt + retention <= this.now()) delete state.handoffs[id];
      for (const [id, pickup] of Object.entries(state.pickups)) if (pickup.resolved && pickup.createdAt + retention <= this.now()) delete state.pickups[id];
      const result = update(state);
      for (const key of ["asks", "handoffs", "pickups"] as const) {
        const entries = Object.keys(state[key]);
        if (entries.length > 4000) throw new Error("Too many collaboration records. Nothing was sent.");
      }
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      await writeAtomic(path.join(this.root, "team.json"), JSON.stringify(state));
      fs.chmodSync(path.join(this.root, "team.json"), 0o600);
      return result;
    });
  }
  lock<Result>(key: string, work: () => Promise<Result>): Promise<Result> {
    return withPluginMutationLock(path.join(this.root, "team-" + key.replace(/[^a-zA-Z0-9_-]/g, "_")), work);
  }
}
