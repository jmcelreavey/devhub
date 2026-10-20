import { createHash } from "node:crypto";
import { z } from "zod";
import { credential } from "./accounts";
import { validTelegramToken } from "./telegram";
import { alertText, type AlertEntry, type Destination } from "./alert-types";
import { isPrAlert, prAnnouncementText } from "./pr-announcement";
import { readSlackSettings } from "./slack/settings";
export interface Delivery { state: "sent" | "unknown" | "failed" | "pending"; receipt?: string; detail: string; retryAfter?: number }
export function alertRequest(destination: Destination, entry: Pick<AlertEntry, "kind" | "taskId" | "announcement">, secret: string): { url: string; body: string } {
  const text = alertText(entry.kind, entry.taskId, destination.publicBaseUrl);
  if (destination.provider === "slack") {
    const u = new URL(secret);
    if (u.protocol !== "https:" || u.hostname !== "hooks.slack.com" || u.port || u.username || u.password || u.search || u.hash || !/^\/services\/[a-zA-Z0-9]+\/[a-zA-Z0-9]+\/[a-zA-Z0-9]+$/.test(u.pathname)) throw new Error("Use a Slack incoming webhook for the chosen channel.");
    const richText = destination.includePrDetails && isPrAlert(entry.kind) && entry.announcement
      ? prAnnouncementText(entry.kind, entry.announcement, readSlackSettings().allowedUserId) : undefined;
    return { url: u.href, body: JSON.stringify({ text: richText ?? text, mrkdwn: Boolean(richText), ...(richText ? { parse: "none", link_names: false } : {}), unfurl_links: false, unfurl_media: false }) };
  }
  if (!validTelegramToken(secret) || !destination.chatId) throw new Error("Configure a Telegram bot token and explicit chat ID.");
  return { url: "https://api.telegram.org/bot" + secret + "/sendMessage", body: JSON.stringify({ chat_id: destination.chatId, text, link_preview_options: { is_disabled: true } }) };
}
const TelegramResponse = z.object({ ok: z.boolean(), result: z.object({ message_id: z.number() }).optional(), error_code: z.number().optional(), parameters: z.object({ retry_after: z.number().optional() }).optional() });
export function credentialFingerprint(value: string) { return createHash("sha256").update(value).digest("hex"); }
export async function sendAlert(destination: Destination, entry: AlertEntry, fetcher: typeof fetch = fetch): Promise<Delivery> {
  let request: { url: string; body: string };
  try {
    const secret = credential(destination.credentialRef);
    if (credentialFingerprint(secret) !== destination.credentialHash) return { state: "failed", detail: "Credential changed. Use Change settings to review and confirm this destination again." };
    request = alertRequest(destination, entry, secret);
  }
  catch { return { state: "failed", detail: "Credential or destination is invalid. Check the server environment, restart DevHub and review this destination." }; }
  try {
    const response = await fetcher(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: request.body, redirect: "error", signal: AbortSignal.timeout(10000) });
    const raw = await response.text();
    const telegram = destination.provider === "telegram" ? TelegramResponse.safeParse(JSON.parse(raw)) : null;
    const status = telegram?.success && !telegram.data.ok ? telegram.data.error_code ?? response.status : response.status;
    if (status === 429) {
      const seconds = telegram?.success ? telegram.data.parameters?.retry_after : Number(response.headers.get("retry-after"));
      return { state: "pending", retryAfter: Math.min(86400, Math.max(2, Number(seconds) || 60)), detail: "Rate limited; will retry after the provider delay." };
    }
    if (status >= 400 && status < 500) return { state: "failed", detail: status === 403 ? "Recipient blocked the bot or access was revoked." : "Provider rejected delivery. Check this destination before retrying." };
    if (response.ok && (destination.provider === "slack" ? raw.trim() === "ok" : telegram?.success && telegram.data.ok && telegram.data.result)) {
      return { state: "sent", detail: "Accepted by provider.", receipt: destination.provider === "slack" ? "webhook-accepted" : String(telegram && telegram.success ? telegram.data.result?.message_id : "") };
    }
    return { state: "unknown", detail: "Provider response did not confirm delivery. Check the channel before retrying; a duplicate is possible." };
  } catch {
    // A failed response read does not prove the provider rejected the POST.
    return { state: "unknown", detail: "Connection interrupted. Check the channel before retrying; a duplicate is possible." };
  }
}
