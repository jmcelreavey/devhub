import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { writeAtomic } from "@/lib/atomic-write";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { alertRoot } from "../alert-store";
import type { SlackDelivery } from "./shared";
import { readStateFile } from "./state-file";

const MAX_AGE = 24 * 60 * 60 * 1000;
const StateSchema = z.object({
  version: z.literal(1),
  seen: z.array(z.object({ keys: z.array(z.string()), at: z.number() })).max(4000),
  tests: z.array(z.object({ requestId: z.string(), revision: z.string(), profile: z.string(), state: z.enum(["sending", "sent", "failed", "unknown"]), detail: z.string() })).max(200),
  nextSendAt: z.number().default(0),
  botThreads: z.array(z.object({ key: z.string(), at: z.number() })).default([]),
});
type State = z.infer<typeof StateSchema>;

export function slackStateRoot(): string { return path.join(alertRoot(), "slack"); }

export function knownSlackBotThread(key: string, root = slackStateRoot(), now = Date.now()): boolean {
  return read(root).botThreads.some((entry) => entry.key === key && now - entry.at < 30 * MAX_AGE);
}

export async function rememberSlackBotThread(key: string, root = slackStateRoot(), now = Date.now()): Promise<void> {
  await withPluginMutationLock(root, async () => {
    const state = read(root);
    state.botThreads = [...state.botThreads.filter((entry) => entry.key !== key && now - entry.at < 30 * MAX_AGE).slice(-3999), { key, at: now }];
    await persist(root, state);
  });
}

function read(root: string): State {
  return readStateFile(path.join(root, "state.json"), (value) => StateSchema.parse(value), () => ({ version: 1, seen: [], tests: [], nextSendAt: 0, botThreads: [] }));
}

async function persist(root: string, state: State): Promise<void> {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  await writeAtomic(path.join(root, "state.json"), JSON.stringify(state));
  fs.chmodSync(path.join(root, "state.json"), 0o600);
}

export async function claimSlackEnvelope(keys: readonly string[], root = slackStateRoot(), now = Date.now()): Promise<boolean> {
  return withPluginMutationLock(root, async () => {
    const state = read(root);
    state.seen = state.seen.filter((item) => now - item.at < MAX_AGE);
    const hashes = keys.map((key) => createHash("sha256").update(key).digest("hex"));
    if (state.seen.some((item) => item.keys.some((key) => hashes.includes(key)))) return false;
    state.seen = [...state.seen.slice(-3999), { keys: hashes, at: now }];
    await persist(root, state);
    return true;
  });
}

export async function reserveSlackSend(root = slackStateRoot(), now = Date.now()): Promise<number> {
  return withPluginMutationLock(root, async () => {
    const state = read(root);
    const sendAt = Math.max(now, state.nextSendAt);
    state.nextSendAt = sendAt + 1100;
    await persist(root, state);
    return Math.max(0, sendAt - now);
  });
}

export async function recordSlackTest(
  requestId: string, revision: string, profile: string, send: () => Promise<SlackDelivery>, root = slackStateRoot(),
): Promise<SlackDelivery> {
  return withPluginMutationLock(root, async () => {
    const state = read(root);
    const previous = state.tests.find((item) => item.requestId === requestId);
    if (previous) {
      if (previous.revision !== revision || previous.profile !== profile) throw new Error("test-settings-changed");
      return previous.state === "sending" ? { state: "unknown", detail: "Delivery is unknown. Check the channel; this request will not be sent again." } : { state: previous.state, detail: previous.detail };
    }
    const entry: State["tests"][number] = { requestId, revision, profile, state: "sending", detail: "Sending one test message." };
    state.tests = [...state.tests.slice(-199), entry];
    await persist(root, state);
    const delivery = await send();
    const latest = read(root);
    const recorded = latest.tests.find((item) => item.requestId === requestId);
    if (!recorded) throw new Error("Slack test record is missing");
    Object.assign(recorded, delivery);
    await persist(root, latest);
    return delivery;
  });
}
