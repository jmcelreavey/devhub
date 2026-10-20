import type { KnownBlock } from "@slack/web-api";
import { HANDOFF_PICKUP_ACTION, HANDOFF_DECLINE_ACTION } from "@shared/slack-gateway/protocol";
import { clipSlackText, escapeSlackText, slackContext, slackTextMessage } from "@/lib/integrations/slack/format";
import type { SlackMessage } from "@/lib/integrations/slack/client";
import type { TeamBundle } from "./store";

export const TEAM_ACTIONS = ["devhub_team_channel", "devhub_team_ask", "devhub_team_handoff", "devhub_team_send", "devhub_team_edit", "devhub_team_dismiss", "devhub_team_confirm", "devhub_team_cancel", "devhub_team_jira", HANDOFF_PICKUP_ACTION, HANDOFF_DECLINE_ACTION] as const;
export function safeTeamText(text: string, limit = 2800): string {
  return clipSlackText(escapeSlackText(text.replace(/<[@!][^>]*>/g, "").replace(/@(here|channel|everyone)\b/gi, "")), limit);
}
export function teamSection(text: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text: safeTeamText(text) || "No details yet", verbatim: true } };
}
function teamSections(text: string): KnownBlock[] {
  const escaped = safeTeamText(text, Math.max(1, text.length * 6));
  const blocks: KnownBlock[] = [];
  for (let offset = 0; offset < escaped.length; offset += 2800) blocks.push({ type: "section", text: { type: "mrkdwn", text: escaped.slice(offset, offset + 2800), verbatim: true } });
  return blocks;
}
function teamHeader(text: string): KnownBlock {
  return { type: "header", text: { type: "plain_text", text: safeTeamText(text, 150) || "Team" } };
}
function teamField(label: string, value: string): KnownBlock[] {
  return teamSections("*" + label + "*\n" + value);
}
function button(action_id: string, text: string, value: string, style?: "primary" | "danger") {
  return { type: "button" as const, action_id, text: { type: "plain_text" as const, text }, value, ...(style ? { style } : {}) };
}
export function teamTaskActions(taskId: string): KnownBlock[] {
  return [{ type: "actions", block_id: "team_task_" + taskId, elements: [
    { type: "conversations_select", action_id: "devhub_team_channel", placeholder: { type: "plain_text", text: "Post in… (optional)" }, filter: { include: ["public", "private"], exclude_bot_users: true } },
    { type: "users_select", action_id: "devhub_team_ask", placeholder: { type: "plain_text", text: "Ask a teammate…" } },
    { type: "users_select", action_id: "devhub_team_handoff", placeholder: { type: "plain_text", text: "Hand off to…" } },
  ] }];
}
export function askCard(context: string[], channel?: string): { text: string; blocks: KnownBlock[] } {
  const footer = channel ? "Reply in this thread" : "Reply here";
  const question = context.filter((text) => /^(?:\*Question\*|Question:)/.test(text));
  const detail = context.filter((text) => !question.includes(text));
  const blocks: KnownBlock[] = [teamHeader("A question for you"), ...question.flatMap((text) => teamSections(text.replace(/^Question: ?/, "*Question*\n"))),
    ...(question.length && detail.length ? [{ type: "divider" as const }] : []), ...detail.flatMap(teamSections), slackContext(footer)];
  if (blocks.length > 45) throw new Error("The question context is too long for Slack. Shorten the task summary first.");
  // The fallback text (notifications, screen readers) is plain: "*Plan*\nAdd…" reads as "Plan: Add…".
  return { text: safeTeamText(context.join("\n\n").replace(/^\*([^*\n]+)\*\n/gm, "$1: "), 30000) + "\n\n" + footer, blocks };
}
export function suggestionCard(channel: string, helper: string, question: string, answer: string, token?: string): SlackMessage {
  const title = "Suggested answer from @" + helper;
  return slackTextMessage(channel, title, undefined, [teamHeader("Suggested answer"), ...teamField("From", "@" + helper), ...teamField("Question", question), { type: "divider" }, ...teamField("Suggested answer", answer),
    slackContext("Only the task owner can send this answer to the agent."),
    ...(token ? [{ type: "actions" as const, elements: [button("devhub_team_send", "Send as answer", token, "primary"), button("devhub_team_edit", "Edit", token), button("devhub_team_dismiss", "Dismiss", token)] }] : [slackContext("That question changed or was already answered. Nothing was sent to the agent.")]),
  ]);
}
export function handoffConfirmCard(channel: string, name: string, files: string[], token: string, jira: boolean, reassignJira: boolean): SlackMessage {
  return slackTextMessage(channel, "Hand off to @" + name + "?", undefined, [
    teamHeader("Confirm handoff"),
    ...teamField("To", "@" + name),
    teamSection("This stops the running agent, pushes this task's branch, writes a handoff note and sends it to @" + name + ". Your task becomes read-only."),
    { type: "divider" },
    teamSection("*Working tree*\n" + (files.length ? "Uncommitted changes:\n" + files.slice(0, 50).join("\n") + (files.length > 50 ? "\n…and " + (files.length - 50) + " more files" : "") : "No uncommitted changes.")),
    slackContext("Nothing changes until you confirm. Cancel keeps the task with you."),
    ...(jira ? [{ type: "actions" as const, elements: [{ type: "checkboxes" as const, action_id: "devhub_team_jira", options: [{ text: { type: "plain_text" as const, text: "Reassign Jira ticket to them" }, value: "reassign" }], ...(reassignJira ? { initial_options: [{ text: { type: "plain_text" as const, text: "Reassign Jira ticket to them" }, value: "reassign" }] } : {}) }] }] : []),
    { type: "actions", elements: [button("devhub_team_confirm", files.length ? "Commit WIP and push" : "Push and hand off", token, "danger"), button("devhub_team_cancel", "Cancel", token)] },
  ]);
}
export function splitNote(note: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < note.length; offset += 2400) chunks.push(note.slice(offset, offset + 2400));
  return chunks.slice(0, 12);
}
export function receiverCard(bundle: TeamBundle, owner: string, note: string): { text: string; blocks: KnownBlock[] } {
  if (!note || note.length > 28800) throw new Error("The handoff note is too long for Slack. Shorten it before handing off.");
  const value = JSON.stringify(bundle);
  if (value.length > 1900) throw new Error("This handoff is too large for Slack. Shorten the task title or links first.");
  return { text: safeTeamText("@" + owner + " wants to hand you " + bundle.title, 4000), blocks: [teamHeader("Task handoff"),
    ...teamField("From", "@" + owner), ...teamField("Task", bundle.title),
    ...(bundle.jiraKey ? teamField("Ticket", bundle.jiraKey) : []),
    ...teamField("Branch / PR", [bundle.branch, bundle.prUrl].filter(Boolean).join("\n")),
    { type: "divider" }, teamSection("*Handoff note*"),
    ...splitNote(note).map((text, index): KnownBlock => ({ type: "section", block_id: "team_handoff_note_" + index, text: { type: "plain_text", text } })),
    slackContext("Pick up to continue on your DevHub, or decline to leave it with the owner."),
    { type: "actions", elements: [button(HANDOFF_PICKUP_ACTION, "Pick up", value, "primary"), button(HANDOFF_DECLINE_ACTION, "Decline", bundle.handoffId)] },
  ] };
}
export function handedToCard(channel: string, name: string, accepted: boolean): SlackMessage {
  const title = (accepted ? "Handed to @" : "Handing to @") + name + (accepted ? "" : "…");
  return slackTextMessage(channel, title, undefined, [teamHeader(accepted ? "Handoff accepted" : "Handoff sent"),
    ...teamField("To", "@" + name), slackContext(accepted ? "They’ve picked up the task. Your copy stays read-only." : "Waiting for them to pick up or decline. Your task is read-only while the handoff is pending.")]);
}

