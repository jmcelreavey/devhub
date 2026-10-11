import fs from "node:fs";
import path from "node:path";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";
import { profileStateDir } from "@/lib/profile-state";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { writeAtomic } from "@/lib/atomic-write";
import { credential } from "./accounts";
import { IntegrationError } from "./types";
import { requestWrite, listWrites } from "./write-store";
import { WriteInputSchema } from "./write-types";

const Rule = z.object({ user: z.string().min(1), channel: z.string().min(1), team: z.string().optional(), profile: z.string().min(1), accounts: z.array(z.string().regex(/^(jira|github):[a-zA-Z0-9_-]+$/)).min(1).max(30) }).strict();
export interface ChatPrincipal { provider: "slack" | "telegram"; user: string; channel: string; team?: string }
export interface ChatCommand { principal: ChatPrincipal; id: string; text: string; rule: z.infer<typeof Rule> }
interface ChatConfiguration { enabled: boolean; rules: z.infer<typeof Rule>[]; secret: string }
export function chatConfiguration(provider: "slack" | "telegram"): ChatConfiguration {
  const prefix = "DEVHUB_" + provider.toUpperCase();
  const enabled = process.env[prefix + "_COMMANDS"] === "1";
  if (!enabled) return { enabled: false, rules: [], secret: "" };
  const rules = z.array(Rule).min(1).max(100).parse(JSON.parse(credential(prefix + "_ALLOWLIST")));
  const secret = credential(prefix + (provider === "slack" ? "_SIGNING_SECRET" : "_WEBHOOK_SECRET"));
  if (secret.length < 32 || secret.length > 256) throw new IntegrationError("auth", "Use a webhook secret of 32–256 characters.");
  return { enabled, rules, secret };
}
export function chatStatus(profile: string) {
  return (["slack", "telegram"] as const).map((provider) => {
    try { const config = chatConfiguration(provider); return { provider, enabled: config.enabled, configured: config.enabled, allowed: config.rules.filter((r) => r.profile === profile).length }; }
    catch { return { provider, enabled: true, configured: false, allowed: 0 }; }
  });
}
function equal(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function identityId(value: string) {
  const hash = createHash("sha256").update(value).digest("hex");
  return hash.slice(0, 8) + "-" + hash.slice(8, 12) + "-4" + hash.slice(13, 16) + "-a" + hash.slice(17, 20) + "-" + hash.slice(20, 32);
}
export function authenticateChat(provider: "slack" | "telegram", headers: Headers, raw: string, profile: string, now = Date.now(), config = chatConfiguration(provider)): ChatCommand {
  if (!config.enabled || headers.has("origin")) throw new IntegrationError("auth", "Chat commands are disabled or unauthorised.");
  let principal: ChatPrincipal; let text: string; let identity: string;
  if (provider === "slack") {
    const timestamp = headers.get("x-slack-request-timestamp") ?? "";
    const signature = headers.get("x-slack-signature") ?? "";
    if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new IntegrationError("auth", "Expired Slack request.");
    const expected = "v0=" + createHmac("sha256", config.secret).update("v0:" + timestamp + ":" + raw).digest("hex");
    if (!equal(signature, expected)) throw new IntegrationError("auth", "Invalid Slack signature.");
    const body = new URLSearchParams(raw);
    if (body.get("command") !== "/devhub") throw new IntegrationError("invalid", "Use /devhub.");
    principal = { provider, user: body.get("user_id") ?? "", channel: body.get("channel_id") ?? "", team: body.get("team_id") ?? "" };
    text = body.get("text") ?? "";
    identity = provider + ":" + signature;
  } else {
    if (!equal(headers.get("x-telegram-bot-api-secret-token") ?? "", config.secret)) throw new IntegrationError("auth", "Invalid Telegram secret.");
    const body = z.object({ update_id: z.number().int().nonnegative(), message: z.object({
      date: z.number().int(), text: z.string().max(24000),
      from: z.object({ id: z.number().int(), is_bot: z.literal(false) }),
      chat: z.object({ id: z.number().int(), type: z.literal("private") }),
      forward_origin: z.unknown().optional(),
    }) }).parse(JSON.parse(raw));
    if (Math.abs(now / 1000 - body.message.date) > 300 || body.message.forward_origin || !/^\/devhub(?:\s|$)/.test(body.message.text)) throw new IntegrationError("auth", "Use a fresh /devhub command in a private bot chat.");
    principal = { provider, user: String(body.message.from.id), channel: String(body.message.chat.id) };
    text = body.message.text.replace(/^\/devhub\s*/, "");
    identity = provider + ":" + createHash("sha256").update(config.secret).digest("hex") + ":" + body.update_id;
  }
  const rule = config.rules.find((r) => r.profile === profile && r.user === principal.user && r.channel === principal.channel && (provider !== "slack" || r.team === principal.team));
  if (!rule) throw new IntegrationError("auth", "This sender and conversation are not allowed in the active work profile.");
  return { principal, text, rule, id: identityId(identity) };
}
interface Receipt { id: string; principal: string; at: number; text: string }
export async function handleChat(command: ChatCommand, options: { root?: string; writeRoot?: string; now?: number } = {}) {
  const root = options.root ?? path.join(profileStateDir(), "integration-chat"); const now = options.now ?? Date.now();
  return withPluginMutationLock(root, async () => {
    const file = path.join(root, "receipts.json");
    let receipts: Receipt[] = [];
    try { receipts = z.array(z.object({ id: z.string(), principal: z.string(), at: z.number(), text: z.string() })).parse(JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    receipts = receipts.filter((r) => r.at > now - 24 * 3600000);
    const prior = receipts.find((r) => r.id === command.id);
    if (prior) return { text: prior.text, duplicate: true };
    const principal = JSON.stringify([command.principal, command.rule.profile]);
    if (receipts.filter((r) => r.principal === principal && r.at > now - 60000).length >= 10 || receipts.length >= 1000) throw new IntegrationError("rate-limit", "Too many commands. Wait a minute and try again.");
    const text = command.text.trim(); let reply: string;
    if (text === "help" || !text) reply = "Commands: help; status; status <proposal-id>; propose <action JSON>. Writes always need a separate review and confirmation in DevHub → Integrations. Chat cannot approve actions.";
    else if (/^status(?: [a-f0-9-]{36})?$/.test(text)) {
      const own = listWrites(command.rule.profile, options.writeRoot).filter((p) => p.source === principal);
      const id = text.split(" ")[1];
      const proposal = id ? own.find((p) => p.id === id) : null;
      reply = id ? proposal ? "Action " + id + ": " + proposal.state + ". Open Integrations for details." : "Action not found for this sender." : own.filter((p) => ["requested", "pending"].includes(p.state) && Date.parse(p.expiresAt) > now).length + " actions await review. Open DevHub → Integrations.";
    } else if (text.startsWith("propose ")) {
      const input = WriteInputSchema.parse(JSON.parse(text.slice(8)));
      if (!command.rule.accounts.includes(input.provider + ":" + input.account)) throw new IntegrationError("auth", "This account is not allowed for this sender.");
      const proposal = await requestWrite(input, command.rule.profile, principal, { root: options.writeRoot, now, id: command.id });
      reply = "Action " + proposal.id + " awaits review in DevHub → Integrations. Nothing has been sent to " + input.provider + ". The proposal expires in 15 minutes.";
    } else reply = "Unknown command. Use /devhub help. Commands cannot run shell commands, start agents or confirm writes.";
    receipts.push({ id: command.id, principal, at: now, text: reply });
    fs.mkdirSync(root, { recursive: true, mode: 0o700 }); await writeAtomic(file, JSON.stringify(receipts)); fs.chmodSync(file, 0o600);
    return { text: reply, duplicate: false };
  }, { waitMs: 1000 });
}
