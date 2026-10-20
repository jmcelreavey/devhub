import type { KnownBlock } from "@slack/web-api";
import type { SlackMessage } from "./client";
import { clipSlackText, formatSlackCard, slackContext, slackDashboardBaseUrl, slackDashboardUrl, slackOpenButton, slackTextMessage } from "./format";
import type { SlackTool } from "./mcp-catalog";
import { toolResultCard } from "./result-format";

export const SLACK_TEXT_LIMIT = 2800;

/** A same-origin link the tool result already carries (`url`/`href`), else none. */
export function resultUrl(text: string, baseUrl = slackDashboardBaseUrl()): string | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof item !== "object" || item === null) return undefined;
  for (const key of ["url", "href", "link"]) {
    const value = (item as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value, baseUrl);
      if (url.origin === new URL(baseUrl).origin && !url.username && !url.password) return url.toString();
    } catch {}
  }
  return undefined;
}

export function readableResult(text: string): string {
  return toolResultCard({ tool: "result", text, profile: "" }).sections.flatMap((section) => section.items.map((item) => [item.title, item.meta].filter(Boolean).join(" · "))).join("\n");
}

export function formatToolResult(input: { tool: string; text: string; data?: unknown; args?: Record<string, unknown>; isError?: boolean; channel: string; threadTs?: string; summary?: string; profile: string; baseUrl?: string }): SlackMessage {
  const card = toolResultCard(input);
  if (input.isError) {
    const setup = /not configured|not authenticated|re-?auth|reconnect|missing.scope|invalid.auth/i.test(input.text);
    return formatSlackCard({
      title: "Couldn't load that", profile: input.profile, href: setup ? "/setup" : card.href,
      sections: [{ items: [{ title: setup ? "Check the connection in Setup, then try again." : "Open DevHub to check the result before trying again." }] }],
    }, input.channel, input.threadTs, input.baseUrl);
  }
  return formatSlackCard({ ...card, href: resultUrl(input.text, input.baseUrl) ?? card.href }, input.channel, input.threadTs, input.baseUrl);
}

/** One text block holds at most this much (Slack allows 3000; the rest is headroom). */
const PREVIEW_BLOCK_CHARS = 2900;
/** What one Slack message can honestly carry: ~44 of its 50 blocks and ~12k characters. */
const PREVIEW_MAX_BLOCKS = 40;
const PREVIEW_MAX_CHARS = 12_000;

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  const compact = JSON.stringify(value) ?? String(value);
  return compact.length <= 100 ? compact : JSON.stringify(value, null, 2);
}

/** Every key and its whole value, one per line. Nothing is clipped. */
export function describeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (!entries.length) return "no details";
  return entries.map(([key, value]) => `${key}: ${valueText(value)}`).join("\n");
}

function splitText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const newline = rest.lastIndexOf("\n", max);
    if (newline > max / 2) { pieces.push(rest.slice(0, newline)); rest = rest.slice(newline + 1); continue; }
    const cut = /[\uD800-\uDBFF]/.test(rest[max - 1]) ? max - 1 : max;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return [...pieces, rest];
}

/**
 * The arguments a Confirm button approves, split into Slack-sized text blocks. `fits` is false when
 * they can't all be shown in one message; the caller must then not offer Confirm at all.
 */
export function argsPreview(args: Record<string, unknown>): { chunks: string[]; fits: boolean } {
  const entries = Object.entries(args);
  const lines = entries.length ? entries.map(([key, value]) => `${key}: ${valueText(value)}`) : ["no details"];
  const chunks: string[] = [];
  let current = "";
  const flush = () => { if (current) chunks.push(current); current = ""; };
  for (const line of lines) {
    if (line.length > PREVIEW_BLOCK_CHARS) { flush(); chunks.push(...splitText(line, PREVIEW_BLOCK_CHARS)); }
    else if (current && current.length + 1 + line.length <= PREVIEW_BLOCK_CHARS) current += `\n${line}`;
    else { flush(); current = line; }
  }
  flush();
  return { chunks, fits: chunks.length <= PREVIEW_MAX_BLOCKS && chunks.reduce((total, chunk) => total + chunk.length, 0) <= PREVIEW_MAX_CHARS };
}

export function formatConfirmCard(input: { tool: SlackTool; args: Record<string, unknown>; id: string; channel: string; threadTs?: string; profile: string; note?: string; destructive?: boolean }): SlackMessage {
  const destructive = input.destructive ?? input.tool.destructive;
  const warning = `${input.note ? `${input.note} ` : ""}${destructive ? "This can't be undone." : "This changes data or starts something."}`;
  const title = `Run ${input.tool.name} in ${input.profile}?`;
  const text = `${title}\n${describeArgs(input.args)}\n${warning}\nConfirm within 10 minutes.`;
  const blocks: KnownBlock[] = [
    { type: "header", text: { type: "plain_text", text: destructive ? "Confirm destructive action" : "Confirm action" } },
    { type: "section", text: { type: "plain_text", text: clipSlackText(title, 3000) } },
    ...argsPreview(input.args).chunks.map((chunk): KnownBlock => ({ type: "section", text: { type: "plain_text", text: chunk } })),
    slackContext(`${warning} Confirm within 10 minutes.`),
    { type: "actions", elements: [
      { type: "button", action_id: "devhub_tool_confirm", value: input.id, text: { type: "plain_text", text: destructive ? "Yes, run it" : "Confirm" }, style: destructive ? "danger" : "primary" },
      { type: "button", action_id: "devhub_tool_cancel", value: input.id, text: { type: "plain_text", text: "Cancel" } },
    ] },
  ];
  return slackTextMessage(input.channel, text, input.threadTs, blocks);
}

/** The details are more than one Slack message can show, so there is nothing to Confirm here. */
export function formatTooLargeCard(input: { tool: SlackTool; channel: string; threadTs?: string; profile: string }): SlackMessage {
  const text = `Too large to approve from Slack — open in DevHub.\n${input.tool.name} in ${input.profile} was not run.`;
  return slackTextMessage(input.channel, text, input.threadTs, [
    { type: "section", text: { type: "plain_text", text } },
    slackOpenButton(slackDashboardUrl("/")),
  ]);
}

/** The same card with the buttons gone, so a settled confirmation can't be clicked again. */
export function formatSettledCard(channel: string, text: string): SlackMessage {
  return slackTextMessage(channel, text);
}

/**
 * Up to five labelled buttons. A "run" choice is the confirmation itself (its label names the
 * exact target); a "pick" choice fills the details and then asks to Confirm.
 */
export function formatChoiceCard(input: { title: string; hint: string; choices: ReadonlyArray<{ label: string; id: string; pick?: boolean }>; channel: string; threadTs?: string }): SlackMessage {
  const text = `${input.title}\n${input.hint}\n${input.choices.map((choice) => `• ${choice.label}`).join("\n")}`;
  return slackTextMessage(input.channel, text, input.threadTs, [
    { type: "section", text: { type: "mrkdwn", text: clipSlackText(`*${input.title}*`, 3000) } },
    slackContext(`${input.hint} Expires in 10 minutes.`),
    { type: "actions", elements: [
      ...input.choices.slice(0, 5).map((choice, index) => ({
        type: "button" as const, action_id: `${choice.pick ? "devhub_tool_pick" : "devhub_tool_choose"}_${index + 1}`, value: choice.id,
        text: { type: "plain_text" as const, text: clipSlackText(choice.label, 70) },
      })),
    ] },
  ]);
}

export function formatPickCard(input: { choices: ReadonlyArray<{ tool: SlackTool; id: string; label?: string }>; channel: string; threadTs?: string }): SlackMessage {
  const text = "Did you mean…?";
  return slackTextMessage(input.channel, text, input.threadTs, [
    { type: "section", text: { type: "plain_text", text } },
    { type: "actions", elements: input.choices.slice(0, 3).map(({ tool, id, label }, index) => ({
      type: "button" as const, action_id: `devhub_tool_pick_${index + 1}`, value: id,
      text: { type: "plain_text" as const, text: clipSlackText(label ?? (tool.description ? `${tool.name.replace(/_/g, " ")} — ${tool.description}` : tool.name.replace(/_/g, " ")), 70) },
    })) },
  ]);
}
