import type { KnownBlock } from "@slack/web-api";
import type { SlackMessage } from "./client";
import { escapeSlackText, slackContext, slackDashboardUrl, slackLine, slackLink, slackTextMessage } from "./format";

/** Tools a one-click task change may run, and the only ones an Undo button may run. Nothing else skips Confirm. */
export const QUICK_TOOLS: ReadonlySet<string> = new Set(["tasks_update", "tasks_capture", "task_reopen"]);
export const UNDO_TOOLS: ReadonlySet<string> = new Set(["tasks_update", "tasks_delete"]);

export type QuickChange = "done" | "checked-off" | "reopened" | "added";

const HEADLINES: Record<QuickChange, string> = { done: "✅ Done", "checked-off": "✅ Checked off", reopened: "↩️ Task reopened", added: "➕ Saved to To do" };

export function taskHref(taskId: string, profile: string): string {
  return slackDashboardUrl(`/storyboard?task=${encodeURIComponent(taskId)}&profile=${encodeURIComponent(profile)}`);
}

/**
 * The card after a one-click change: what happened, the task, and Undo beside Open in DevHub. Undo is plain
 * and Open is the link; a change that can't be reversed here (no `undoId`) shows Open alone.
 */
export function formatTaskChange(input: { change: QuickChange; title: string; taskId: string; profile: string; date?: string; undoId?: string; channel: string; threadTs?: string }): SlackMessage {
  const headline = HEADLINES[input.change];
  const href = taskHref(input.taskId, input.profile);
  const hint = input.change === "added" ? "Draft in To do. No agent started." : input.change === "reopened" ? "Open again in DevHub." : "Checked off in DevHub.";
  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `${headline} · ${slackLink(input.title, href)}`, verbatim: true } },
    slackContext(escapeSlackText(input.undoId ? `${hint} Undo is good for 10 minutes.` : hint)),
    { type: "actions", elements: [
      ...(input.undoId ? [{ type: "button" as const, action_id: "devhub_tool_undo", value: input.undoId, text: { type: "plain_text" as const, text: "Undo" } }] : []),
      { type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "Open in DevHub" }, style: "primary", url: href },
    ] },
  ];
  // A ✅ on this card checks the task off (or does nothing if it already is).
  return { ...slackTextMessage(input.channel, `${headline} · ${slackLine(input.title, 160)}`, input.threadTs, blocks), taskRef: { profile: input.profile, taskId: input.taskId, ...(input.date ? { date: input.date } : {}), title: input.title } };
}

/** `tasks_capture` says "Captured draft <id> on <day>: <title>". */
export function parseCaptured(text: string): { taskId: string; date: string; title: string } | undefined {
  const found = /^Captured draft (\S+) on (\d{4}-\d{2}-\d{2}): (.+)$/m.exec(text);
  return found ? { taskId: found[1], date: found[2], title: found[3].trim() } : undefined;
}

/** `tasks_update` says "Updated task: <id> — <title> (…)". */
export function updatedTaskTitle(text: string): string | undefined {
  return /^Updated task: \S+ — (.+?) \(done=/m.exec(text)?.[1];
}
