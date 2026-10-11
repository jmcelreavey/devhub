import { z } from "zod";
import { credential } from "./accounts";
import { IntegrationError } from "./types";

export interface TelegramChat { chatId: string; type: "private" | "group" | "supergroup" | "channel"; userId?: string }
export function validTelegramToken(value: string): boolean { return /^[0-9]+:[a-zA-Z0-9_-]{20,}$/.test(value); }
const Envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), error_code: z.number().optional() });
const Message = z.object({ chat: z.object({ id: z.number().int().safe(), type: z.enum(["private", "group", "supergroup", "channel"]) }), from: z.object({ id: z.number().int().safe(), is_bot: z.boolean() }).optional() });
const Updates = z.array(z.object({ message: Message.optional(), channel_post: Message.optional() })).max(100);
export async function discoverTelegramChats(credentialRef: string, fetcher: typeof fetch = fetch): Promise<TelegramChat[]> {
  const token = credential(credentialRef);
  if (!validTelegramToken(token)) throw new IntegrationError("invalid", "Set a valid Telegram bot token in the referenced server variable, then restart DevHub.");
  async function request(method: string, body: Record<string, number>) {
    let response: Response; let raw: unknown;
    try {
      response = await fetcher("https://api.telegram.org/bot" + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000) });
      raw = await response.json();
    } catch { throw new IntegrationError("unavailable", "Could not read Telegram chats. Check the server connection and try again."); }
    const parsed = Envelope.safeParse(raw);
    const status = parsed.success ? parsed.data.error_code ?? response.status : response.status;
    if (status === 409) throw new IntegrationError("conflict", "Telegram polling is unavailable. A webhook or another getUpdates reader may be active. Enter the chat ID manually; DevHub will not remove the webhook.");
    if (status === 429) throw new IntegrationError("rate-limit", "Telegram rate limited chat discovery. Wait before trying again.");
    if (!response.ok || !parsed.success || !parsed.data.ok) throw new IntegrationError("unavailable", "Telegram could not read chats. Check the bot token and permissions on the server.");
    return parsed.data.result;
  }
  const webhook = z.object({ url: z.string() }).safeParse(await request("getWebhookInfo", {}));
  if (!webhook.success) throw new IntegrationError("unavailable", "Telegram returned an unexpected webhook status. Enter the chat ID manually.");
  if (webhook.data.url) throw new IntegrationError("conflict", "A Telegram webhook is already active. Find my chat ID cannot use getUpdates alongside it. Enter the chat ID manually; DevHub will not remove the webhook.");
  const updates = Updates.safeParse(await request("getUpdates", { limit: 100, timeout: 0 }));
  if (!updates.success) throw new IntegrationError("unavailable", "Telegram returned unexpected updates. Enter the chat ID manually.");
  const chats = new Map<string, TelegramChat>();
  for (const update of updates.data.toReversed()) {
    const message = update.message ?? update.channel_post;
    if (!message) continue;
    const chat: TelegramChat = { chatId: String(message.chat.id), type: message.chat.type, ...(message.from && !message.from.is_bot ? { userId: String(message.from.id) } : {}) };
    if (!chats.has(chat.chatId)) chats.set(chat.chatId, chat);
  }
  return [...chats.values()];
}
