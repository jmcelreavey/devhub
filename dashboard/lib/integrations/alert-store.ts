import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { profileStateDir } from "@/lib/profile-state";
import { writeAtomic } from "@/lib/atomic-write";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { DestinationSchema, EventKind, isQuiet, type Destination, type AlertEntry, type DestinationInput, type AlertKind } from "./alert-types";
import { credential } from "./accounts";
import { sendAlert, alertRequest, credentialFingerprint, type Delivery } from "./alert-send";
import { IntegrationError } from "./types";
import { readSlackSettings } from "./slack/settings";
import { PrAnnouncementSchema, SlackOwnerIdSchema, freshPrAlert, isPrAlert, type PrAnnouncement } from "./pr-announcement";

interface AlertState { version: 1; destinations: Destination[]; outbox: AlertEntry[]; nextSendAt: number }
const EntrySchema = z.object({
  id: z.string(), destinationId: z.string().uuid(), consentRevision: z.number().int(), eventId: z.string(), taskId: z.string(),
  workProfile: z.string(), kind: z.union([EventKind, z.literal("test")]), createdAt: z.string().datetime(), state: z.enum(["pending", "sending", "sent", "unknown", "failed", "cancelled"]),
  announcement: PrAnnouncementSchema.optional(),
  attempts: z.number().int().nonnegative(), nextAttempt: z.number(), receipt: z.string().optional(), detail: z.string().optional(),
});
const StateSchema = z.object({ version: z.literal(1), destinations: z.array(z.unknown()), outbox: z.array(EntrySchema), nextSendAt: z.number() });
// DestinationSchema is strict, so validate its persisted metadata separately.
function validateDestination(raw: unknown): Destination {
  const { revision, consentAt, credentialHash, ...value } = z.object({ revision: z.number().int().positive(), consentAt: z.string().datetime(), credentialHash: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough().parse(raw);
  return { ...DestinationSchema.parse(value), revision, consentAt, credentialHash };
}
export function alertRoot() { return path.join(profileStateDir(), "workflow-alerts"); }
function stateFile(root: string) { return path.join(root, "state.json"); }
export function readAlerts(root = alertRoot()): AlertState {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(root), "utf8"));
    const state = StateSchema.parse(raw);
    return { ...state, destinations: state.destinations.map(validateDestination) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, destinations: [], outbox: [], nextSendAt: 0 }; throw error; }
}
async function persist(root: string, state: AlertState) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  await writeAtomic(stateFile(root), JSON.stringify(state));
  fs.chmodSync(stateFile(root), 0o600);
}
export async function saveDestination(input: DestinationInput, revision: number, profile: string, root = alertRoot(), now = new Date()) {
  const value = DestinationSchema.parse(input);
  if (value.enabled && value.includePrDetails && !SlackOwnerIdSchema.safeParse(readSlackSettings().allowedUserId).success) throw new IntegrationError("invalid", "Set the owner’s Slack user ID in Setup → Slack before sharing PR details.");
  if (value.workProfile !== profile) throw new IntegrationError("invalid", "Select the active work profile before changing its alerts.");
  return withPluginMutationLock(root, async () => {
    const state = readAlerts(root);
    const previous = state.destinations.find((d) => d.id === value.id);
    if ((previous?.revision ?? 0) !== revision) throw new IntegrationError("conflict", "Destination changed. Refresh before saving.");
    if (previous && previous.workProfile !== profile) throw new IntegrationError("invalid", "This destination belongs to another work profile.");
    if (!previous && state.destinations.length >= 30) throw new IntegrationError("invalid", "At most 30 destinations are supported.");
    const secret = value.enabled ? credential(value.credentialRef) : "";
    const destination = { ...value, revision: revision + 1, consentAt: now.toISOString(), credentialHash: value.enabled ? credentialFingerprint(secret) : previous?.credentialHash ?? credentialFingerprint("") };
    if (value.enabled) alertRequest(destination, { kind: value.events[0], taskId: "preview" }, secret);
    state.destinations = [...state.destinations.filter((d) => d.id !== value.id), destination];
    for (const item of state.outbox) if (item.destinationId === value.id && item.state === "pending") { item.state = "cancelled"; item.detail = "Consent changed."; }
    await persist(root, state);
    return destination;
  });
}
export async function sendTestAlert(id: string, revision: number, requestId: string, profile: string, options: { root?: string; now?: Date; send?: (d: Destination, e: AlertEntry) => Promise<Delivery> } = {}) {
  const root = options.root ?? alertRoot(); const now = options.now ?? new Date();
  return withPluginMutationLock(root, async () => {
    const state = readAlerts(root);
    const destination = state.destinations.find((d) => d.id === id && d.workProfile === profile);
    if (!destination?.enabled || destination.revision !== revision) throw new IntegrationError("conflict", "Destination is disabled or changed. Review and enable it in DevHub before testing.");
    const entryId = createHash("sha256").update(JSON.stringify([profile, id, "test", requestId])).digest("hex");
    const previous = state.outbox.find((entry) => entry.id === entryId);
    if (previous) {
      if (previous.consentRevision !== revision) throw new IntegrationError("conflict", "Use a new test request after changing consent.");
      if (previous.state === "sending") {
        previous.state = "unknown"; previous.detail = "DevHub stopped during the test. Check the channel before sending another test.";
        await persist(root, state);
      }
      return previous;
    }
    if (state.nextSendAt > now.getTime()) throw new IntegrationError("rate-limit", "Wait a few seconds before sending another test message.");
    const entry: AlertEntry = { id: entryId, destinationId: id, consentRevision: revision, eventId: requestId, taskId: "", workProfile: profile, kind: "test", createdAt: now.toISOString(), state: "sending", attempts: 1, nextAttempt: 0 };
    state.outbox.push(entry); state.nextSendAt = now.getTime() + 3000;
    await persist(root, state);
    const result = await (options.send ?? sendAlert)(destination, entry);
    entry.state = result.state === "pending" ? "failed" : result.state;
    entry.detail = result.state === "pending" ? "Provider rate limited the test. No automatic retry; wait before sending another test." : result.detail;
    entry.receipt = result.receipt;
    await persist(root, state);
    return entry;
  });
}
export async function decideDelivery(id: string, retry: boolean, profile: string, root = alertRoot()) {
  return withPluginMutationLock(root, async () => {
    const state = readAlerts(root);
    const entry = state.outbox.find((e) => e.id === id && e.workProfile === profile);
    if (!entry || !["unknown", "failed", "pending"].includes(entry.state)) throw new IntegrationError("conflict", "This delivery cannot be changed.");
    const destination = state.destinations.find((d) => d.id === entry.destinationId);
    if (retry && (!destination?.enabled || destination.revision !== entry.consentRevision)) throw new IntegrationError("conflict", "Consent changed. This delivery cannot be retried.");
    entry.state = retry ? "pending" : "cancelled"; entry.nextAttempt = 0; entry.attempts = 0;
    entry.detail = retry ? "Manual retry requested; a duplicate is possible." : "Cancelled in DevHub.";
    await persist(root, state);
  });
}
export interface AlertEvent { id: string; at: string; taskId: string; kind: AlertKind; announcement?: PrAnnouncement }
export function classifyAlert(summary: string): AlertKind | null {
  if (summary.startsWith("Verification failed") || summary.startsWith("Verification interrupted")) return "check-failed";
  if (summary.startsWith("Approval requested:")) return "approval-ready";
  if (summary === "review run: completed" || summary === "review run: done") return "review-ready";
  if (summary.startsWith("PR needs attention:")) return "pr-attention";
  if (/^(plan|implement) run: (completed|done)$/.test(summary) || /^(plan|implement|review|discuss|verify) run: needs-attention$/.test(summary)) return "question";
  return null;
}
export async function processAlerts(events: AlertEvent[], profile: string, options: { root?: string; now?: Date; deferPrAlerts?: boolean; send?: (d: Destination, e: AlertEntry) => Promise<Delivery> } = {}) {
  const root = options.root ?? alertRoot(); const now = options.now ?? new Date();
  // Held through the bounded POST: after revocation returns no queued send can start.
  return withPluginMutationLock(root, async () => {
    const state = readAlerts(root);
    for (const item of state.outbox) if (item.state === "sending") { item.state = "unknown"; item.detail = "DevHub stopped during delivery. Check the channel before retrying."; }
    const currentPrEvents = new Set(events.filter((event) => freshPrAlert(event.at, now.getTime())).map((event) => event.id));
    for (const item of state.outbox) if (item.workProfile === profile && item.state === "pending" && isPrAlert(item.kind) && (!freshPrAlert(item.createdAt, now.getTime()) || (!options.deferPrAlerts && !currentPrEvents.has(item.eventId)))) {
      item.state = "cancelled"; item.detail = "PR announcement is no longer current.";
    }
    const known = new Set(state.outbox.map((e) => e.id));
    for (const destination of state.destinations.filter((d) => d.enabled && d.workProfile === profile)) {
      for (const event of events) {
        if (isPrAlert(event.kind) && !freshPrAlert(event.at, now.getTime())) continue;
        if (Date.parse(event.at) < Date.parse(destination.consentAt) || !destination.events.includes(event.kind)) continue;
        const id = createHash("sha256").update(JSON.stringify([profile, destination.id, event.id])).digest("hex");
        if (known.has(id)) continue;
        known.add(id);
        const announcement = destination.provider === "slack" && destination.includePrDetails && isPrAlert(event.kind) && event.announcement
          ? PrAnnouncementSchema.parse(event.announcement) : undefined;
        state.outbox.push({ id, destinationId: destination.id, consentRevision: destination.revision, eventId: event.id, taskId: event.taskId, kind: event.kind, ...(announcement ? { announcement } : {}), workProfile: profile, createdAt: event.at, state: "pending", attempts: 0, nextAttempt: 0 });
      }
    }
    await persist(root, state);
    const entry = state.outbox.find((e) => e.workProfile === profile && e.state === "pending" && !(options.deferPrAlerts && isPrAlert(e.kind)) && e.nextAttempt <= now.getTime() && state.destinations.some((d) => d.id === e.destinationId && !isQuiet(d, now)));
    if (!entry || state.nextSendAt > now.getTime()) return;
    const destination = state.destinations.find((d) => d.id === entry.destinationId);
    if (!destination?.enabled || destination.revision !== entry.consentRevision) { entry.state = "cancelled"; await persist(root, state); return; }
    entry.state = "sending"; entry.attempts += 1; state.nextSendAt = now.getTime() + 3000;
    await persist(root, state);
    const result = await (options.send ?? sendAlert)(destination, entry);
    Object.assign(entry, result);
    delete (entry as AlertEntry & { retryAfter?: number }).retryAfter;
    if (result.state === "pending") {
      entry.nextAttempt = now.getTime() + Math.max(result.retryAfter ?? 60, 2 ** entry.attempts) * 1000;
      if (entry.attempts >= 5) { entry.state = "failed"; entry.detail = "Rate limit persisted after five attempts. Retry manually later."; }
    }
    await persist(root, state);
  });
}
