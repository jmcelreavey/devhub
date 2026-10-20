import type { WriteProposal } from "./write-types";

/** What a person needs to decide, separated from what an auditor needs to verify. */
export interface WriteView {
  /** The single heading: the action, in words. */
  heading: string;
  /** The verb on the confirm button; shorter than the heading because the heading is already on screen. */
  confirmLabel: string;
  subject?: { label: string; title?: string; url?: string };
  change?: { kind: "status" | "branch" | "text"; from: string; to: string };
  body?: { label: string; text: string };
  facts: Array<{ label: string; value: string }>;
  technical: Array<{ label: string; value: string }>;
  link?: { label: string; href: string };
}

const PROVIDER_LABEL: Record<string, string> = { jira: "Jira", github: "GitHub", slack: "Slack", telegram: "Telegram" };
export const providerLabel = (provider: string) => PROVIDER_LABEL[provider] ?? provider;

/** "John McElreavey (712020:6f1c…)" → "John McElreavey". Raw ids stay under Details. */
export function actorName(actor: string): { name: string; id: string | null } {
  const match = actor.match(/^(.*\S)\s+\(([^()]+)\)$/);
  return match ? { name: match[1], id: match[2] } : { name: actor, id: null };
}

interface ChatSender { provider: string; user: string; channel: string; team?: string }
function chatSource(source: string): { sender: ChatSender; profile: string } | null {
  try {
    const [sender, profile] = JSON.parse(source) as [ChatSender, string];
    return sender && typeof sender.provider === "string" ? { sender, profile } : null;
  } catch { return null; }
}
/** Plain-language origin of a request. */
export function sourceName(source: string): string {
  if (source === "DevHub") return "You, in DevHub";
  if (source === "MCP") return "An agent through MCP";
  const chat = chatSource(source);
  return chat ? "A " + providerLabel(chat.sender.provider) + " chat request" : "A chat request";
}
export function sourceDetail(source: string): string {
  const chat = chatSource(source);
  if (!chat) return source === "DevHub" ? "DevHub" : source;
  const { sender, profile } = chat;
  return [sender.provider, "user " + sender.user, "conversation " + sender.channel, sender.team ? "workspace " + sender.team : "", "profile " + profile].filter(Boolean).join(" · ");
}

const text = (value: unknown) => value === null || value === undefined ? "" : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
const short = (value: string, max = 90) => value.length > max ? value.slice(0, max - 1) + "…" : value;

export function describeWrite(proposal: WriteProposal): WriteView {
  const { input, prepared } = proposal;
  const d = prepared?.details ?? {};
  const who = prepared ? actorName(prepared.actor) : null;
  const facts: WriteView["facts"] = [];
  if (who) facts.push({ label: "Account", value: who.name + " · " + providerLabel(input.provider) });
  facts.push({ label: "Requested by", value: sourceName(proposal.source) });
  const technical: WriteView["technical"] = [];
  if (prepared) technical.push({ label: "Destination", value: prepared.destination });
  if (who?.id) technical.push({ label: providerLabel(input.provider) + " account id", value: who.id });
  technical.push({ label: "DevHub account", value: input.account });
  technical.push({ label: "Request source", value: sourceDetail(proposal.source) });
  technical.push({ label: "Action id", value: proposal.id });
  const link = prepared?.destination.startsWith("https://") ? { label: "Open in " + providerLabel(input.provider), href: prepared.destination } : undefined;
  const base = { facts, technical, link };

  if (input.action === "issue.assign-self") {
    return { ...base, heading: prepared?.summary ?? "Assign " + input.ref.id + " to you", confirmLabel: "Assign to me", subject: { label: input.ref.id, url: link?.href } };
  }
  if (input.action === "issue.transition") {
    const key = input.ref.id; const to = text(d.to);
    if (d.transition !== undefined) technical.unshift({ label: "Transition", value: text(d.transition) + " (id " + text(d.transitionId) + ")" });
    else technical.unshift({ label: "Transition id", value: input.transitionId });
    return { ...base, heading: prepared?.summary ?? "Move " + key, confirmLabel: to ? "Move to " + to : "Move ticket",
      subject: { label: key, title: text(d.ticket) || undefined, url: link?.href },
      change: d.from !== undefined && to ? { kind: "status", from: text(d.from), to } : undefined };
  }
  if (input.action === "issue.create") {
    const parent = text(d.parent);
    const rows: WriteView["facts"] = [];
    if (parent) rows.push({ label: "Parent", value: parent });
    if (d.assignee) rows.push({ label: "Assignee", value: actorName(text(d.assignee)).name });
    if (d.team) rows.push({ label: "Team", value: text(d.team) });
    facts.unshift(...rows);
    return { ...base, heading: prepared?.summary ?? "Create Jira ticket in " + input.projectKey, confirmLabel: "Create ticket",
      subject: { label: text(d.issueType) || "New ticket", title: input.title }, body: { label: "Description", text: input.body } };
  }
  if (input.action === "pr.create") {
    technical.push({ label: "Head commit", value: text(d.headSha) }, { label: "Base commit", value: text(d.baseSha) });
    return { ...base, heading: prepared?.summary ?? "Create pull request", confirmLabel: input.draft ? "Create draft PR" : "Create PR",
      subject: { label: input.repo, title: input.title }, change: { kind: "branch", from: input.head, to: input.base }, body: input.body ? { label: "Description", text: input.body } : undefined };
  }
  if (input.action === "pr.update") {
    const before = text(d.previousTitle);
    return { ...base, heading: prepared?.summary ?? "Update pull request", confirmLabel: "Update PR",
      subject: { label: input.ref.id.split("/").slice(0, 2).join("/") + " #" + input.ref.id.split("/")[2], title: short(input.title) },
      change: before && before !== input.title ? { kind: "text", from: before, to: input.title } : undefined,
      body: { label: "New description", text: input.body } };
  }
  technical.push({ label: "Head commit", value: text(d.headSha) });
  return { ...base, heading: prepared?.summary ?? "Mark pull request ready for review", confirmLabel: "Mark ready for review",
    subject: { label: input.ref.id.split("/").slice(0, 2).join("/") + " #" + input.ref.id.split("/")[2], title: text(d.title) || undefined, url: link?.href },
    change: d.head !== undefined ? { kind: "branch", from: text(d.head), to: text(d.base) } : undefined };
}
