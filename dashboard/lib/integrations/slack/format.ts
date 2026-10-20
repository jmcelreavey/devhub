import type { KnownBlock } from "@slack/web-api";
import type { SlackAnswer } from "./answers";
import type { SlackMessage } from "./client";

export const SLACK_LIMITS = { blocks: 50, section: 3000, header: 150, fallback: 4000, items: 6 } as const;

export interface SlackCardItem { title: string; href?: string; status?: string; meta?: string }
export interface SlackCardSection { title?: string; items: readonly SlackCardItem[]; total?: number; href?: string; empty?: string }
export interface SlackCard {
  title: string;
  count?: number;
  profile?: string;
  sections: readonly SlackCardSection[];
  href?: string;
  footer?: string;
}

export function clipSlackText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

export function slackLine(text: string, max = 240): string {
  return clipSlackText(text.replace(/\s+/g, " ").trim(), max);
}

export function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slackLink(title: string, href?: string, baseUrl = slackDashboardBaseUrl()): string {
  const label = escapeSlackText(slackLine(title, 180).replace(/\|/g, "¦"));
  if (!href) return label;
  try {
    const url = new URL(href, baseUrl);
    const target = escapeSlackText(url.toString().replace(/\|/g, "%7C"));
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && target.length <= 1800) return `<${target}|${label}>`;
  } catch {}
  return label;
}

export function slackContext(text: string): KnownBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text: clipSlackText(text, SLACK_LIMITS.section), verbatim: true }] };
}

export function slackOpenButton(url: string): KnownBlock {
  return { type: "actions", elements: [{ type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "Open in DevHub" }, style: "primary", url }] };
}

export function slackTextMessage(channel: string, text: string, threadTs?: string, blocks?: KnownBlock[]): SlackMessage {
  const fallback = escapeSlackText(text.trim() || "Done.");
  return {
    channel, thread_ts: threadTs, text: clipSlackText(fallback, SLACK_LIMITS.fallback),
    blocks: blocks ?? [{ type: "section", text: { type: "plain_text", text: clipSlackText(text.trim() || "Done.", SLACK_LIMITS.section) } }],
    mrkdwn: false, parse: "none", unfurl_links: false, unfurl_media: false,
  };
}

export function slackDashboardBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const port = Number(env.PORT);
  const fallback = `http://localhost:${/^\d{1,5}$/.test(env.PORT ?? "") && port > 0 && port <= 65535 ? port : "1337"}`;
  try {
    const url = new URL(env.DEVHUB_BASE_URL?.trim() || fallback);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return fallback;
    return url.origin;
  } catch { return fallback; }
}

export function slackDashboardUrl(href: string, baseUrl = slackDashboardBaseUrl()): string {
  try {
    const url = new URL(href, baseUrl);
    if (url.origin === new URL(baseUrl).origin && !url.username && !url.password && url.toString().length <= 2000) return url.toString();
  } catch {}
  return new URL("/storyboard", baseUrl).toString();
}

export function slackStatusLabel(status: string): string {
  const normal = status.toLowerCase().replace(/[ _]/g, "-");
  const emoji = /^(?:passing|done|completed|succeeded|success|ready|connected|sent|approved|fixed)$/.test(normal) ? "✅"
    : /^(?:failing|failed|error|blocked|changes-requested)$/.test(normal) ? "❌"
    : /^(?:pending|queued|starting|running|connecting|reconnecting|in-progress)$/.test(normal) ? "⏳"
    : /^(?:draft|draft-pr|todo|to-do)$/.test(normal) ? "📝"
    : /^(?:needs-you|needs-attention|in-review|ready-for-review|review-required)$/.test(normal) ? "👀"
    : /^(?:cancelled|abandoned|closed)$/.test(normal) ? "⏹️" : "•";
  return `${emoji} ${slackLine(status.replace(/[-_]/g, " "), 40)}`;
}

export function formatSlackCard(card: SlackCard, channel: string, threadTs?: string, baseUrl = slackDashboardBaseUrl()): SlackMessage {
  const title = slackLine(`${card.title}${card.count === undefined ? "" : ` · ${card.count}`}`, SLACK_LIMITS.header);
  const blocks: KnownBlock[] = [{ type: "header", text: { type: "plain_text", text: title || "DevHub" } }];
  const fallback = [`${title}${card.profile ? ` · ${slackLine(card.profile, 80)}` : ""}`];
  if (card.profile) blocks.push(slackContext(escapeSlackText(slackLine(card.profile, 80))));
  const sections = card.sections.slice(0, 5);
  const hiddenSections = card.sections.length - sections.length;
  const reserved = blocks.length + Number(!!card.href) + Number(!!card.footer) + Number(hiddenSections > 0)
    + Math.max(0, sections.length - 1) + sections.filter((section) => section.title).length + sections.length;
  let remainingItems = Math.min(16, Math.floor((SLACK_LIMITS.blocks - reserved) / 2));
  for (const [index, section] of sections.entries()) {
    if (index) blocks.push({ type: "divider" });
    const total = Math.max(section.items.length, section.total ?? 0);
    if (section.title) {
      const heading = `${slackLine(section.title, 100)} · ${total}`;
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${escapeSlackText(heading)}*`, verbatim: true } });
      fallback.push(heading);
    }
    const visible = section.items.slice(0, Math.min(SLACK_LIMITS.items, remainingItems));
    remainingItems -= visible.length;
    for (const item of visible) {
      const status = item.status ? `${escapeSlackText(slackLine(item.status, 50))} · ` : "";
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `${status}${slackLink(item.title, item.href, baseUrl)}` || "No details", verbatim: true } });
      if (item.meta?.trim()) blocks.push(slackContext(escapeSlackText(slackLine(item.meta, 300))));
      fallback.push(`${item.status ? `${item.status} · ` : ""}${slackLine(item.title, 180)}${item.meta ? ` — ${slackLine(item.meta, 160)}` : ""}`);
    }
    if (total > visible.length) {
      const more = `+${total - visible.length} more`;
      const destination = section.href ?? card.href;
      blocks.push(slackContext(`${more}${destination ? ` · ${slackLink("Open in DevHub", slackDashboardUrl(destination, baseUrl), baseUrl)}` : " in DevHub"}`));
      fallback.push(`${more} in DevHub`);
    } else if (!visible.length) {
      const empty = slackLine(section.empty ?? "Nothing here just now.", 400);
      blocks.push({ type: "section", text: { type: "plain_text", text: empty } });
      fallback.push(empty);
    }
  }
  if (hiddenSections) {
    blocks.push(slackContext(`+${hiddenSections} more sections in DevHub`));
    fallback.push(`+${hiddenSections} more sections in DevHub`);
  }
  if (card.footer) { blocks.push(slackContext(escapeSlackText(slackLine(card.footer, 500)))); fallback.push(slackLine(card.footer, 500)); }
  if (card.href) blocks.push(slackOpenButton(slackDashboardUrl(card.href, baseUrl)));
  return slackTextMessage(channel, fallback.join("\n"), threadTs, blocks);
}

export function formatSlackAnswer(answer: SlackAnswer, channel: string, baseUrl = slackDashboardBaseUrl()): SlackMessage {
  const items = answer.items ?? answer.lines.map((line) => {
    const [title, ...meta] = line.split("\n");
    return { title, meta: meta.join(" · ") };
  });
  const total = answer.total ?? items.length + answer.more;
  const message = formatSlackCard({
    title: answer.title, profile: answer.profile, count: answer.kind === "tasks" ? total : undefined,
    sections: [{ items, total, empty: answer.lines[0] }], href: answer.href,
  }, channel, undefined, baseUrl);
  return answer.kind === "tasks" && total === 1 && answer.taskRef ? { ...message, taskRef: answer.taskRef } : message;
}
