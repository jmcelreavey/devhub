import { z } from "zod";
import type { PrAnnouncement } from "./pr-announcement";
export const EVENT_LABELS = { question: "Conversation needs you", "check-failed": "Checks failed", "review-ready": "Review is ready", "approval-ready": "Approval is needed", "pr-attention": "Pull request needs attention", "pr-reviewed": "PR got an AI review", "pr-ready": "PR opened / ready for review" } as const;
export const EventKind = z.enum(["question", "check-failed", "review-ready", "approval-ready", "pr-attention", "pr-reviewed", "pr-ready"]);
export type AlertKind = z.infer<typeof EventKind>;
export function safeBaseUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/"
      && !/^(localhost|127\.|0\.|\[|.*\.localhost$)/i.test(u.hostname) && u.hostname.includes(".");
  } catch { return false; }
}
const time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
export const DestinationSchema = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(80), provider: z.enum(["slack", "telegram"]),
  workProfile: z.string().min(1).max(100), credentialRef: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/),
  chatId: z.string().regex(/^-?[1-9][0-9]{0,19}$/).optional(),
  events: z.array(EventKind).min(1).max(EventKind.options.length), enabled: z.boolean(),
  includePrDetails: z.boolean().optional(),
  publicBaseUrl: z.string().max(500).refine(safeBaseUrl, "Use a secure dashboard origin with no path or token.").optional(),
  quiet: z.object({ start: time, end: time, timeZone: z.string().max(100).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }) }).strict().refine((q) => q.start !== q.end, "Quiet hours need different start and end times.").optional(),
}).strict().refine((d) => d.provider !== "telegram" || Boolean(d.chatId), "Bind a Telegram chat ID.").refine((d) => !d.includePrDetails || d.provider === "slack", "PR details can only be shared with a Slack webhook.");
export type DestinationInput = z.infer<typeof DestinationSchema>;
export interface Destination extends DestinationInput { revision: number; consentAt: string; credentialHash: string }
export interface AlertEntry {
  id: string; destinationId: string; consentRevision: number; eventId: string; taskId: string;
  workProfile: string; kind: AlertKind | "test"; createdAt: string;
  state: "pending" | "sending" | "sent" | "unknown" | "failed" | "cancelled";
  attempts: number; nextAttempt: number; receipt?: string; detail?: string;
  announcement?: PrAnnouncement;
}
export function alertText(kind: AlertKind | "test", taskId: string, base?: string): string {
  if (kind === "test") return "DevHub: Test message.\nYour alert destination is connected. Approvals stay in DevHub.";
  const link = base && safeBaseUrl(base) ? new URL("/workflow?taskId=" + encodeURIComponent(taskId), base).href : undefined;
  return "DevHub: " + EVENT_LABELS[kind] + ".\n" + (link || "Open DevHub → Task workflows to review.");
}
export function isQuiet(destination: DestinationInput, now: Date): boolean {
  if (!destination.quiet) return false;
  const q = destination.quiet;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: q.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const current = parts.find((p) => p.type === "hour")!.value + ":" + parts.find((p) => p.type === "minute")!.value;
  return q.start < q.end ? current >= q.start && current < q.end : current >= q.start || current < q.end;
}
