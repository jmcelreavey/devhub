import type { KnownBlock } from "@slack/web-api";
import type { ModalView } from "@slack/types";
import { teamTaskActions } from "@/lib/team/cards";
import type { SlackMessage } from "./client";
import { homeSectionHref } from "@/lib/storyboard/home-summary";
import { clipSlackText, escapeSlackText, formatSlackCard, slackContext, slackDashboardUrl, slackLine, slackLink, slackTextMessage } from "./format";
import { buildTaskReviewMessage } from "@/lib/pr-slack";
import { taskHref } from "./quick-tasks";
import type { SlackMilestone, SlackMilestoneKind } from "./milestones";
import type { SlackNeed } from "./needs-you-source";
import type { SlackThreadItem } from "./thread-store";

export { slackTextMessage } from "./format";

export function compactPrNeedBlocks(item: SlackNeed): KnownBlock[] {
  const rows = item.prRows ?? [];
  return [
    { type: "section", text: { type: "mrkdwn", text: `*Pull requests needing you · ${rows.length}*`, verbatim: true } },
    ...rows.slice(0, 8).map((row): KnownBlock => ({ type: "section", text: { type: "mrkdwn", text: `${slackLink(slackLine(row.title, 180), slackNeedUrl(row))}\n${escapeSlackText(slackLine(row.needed, 120))}`, verbatim: true } })),
    ...(rows.length > 8 ? [slackContext(`+${rows.length - 8} more · ${slackLink("All PRs", slackNeedUrl(item))}`)] : []),
  ];
}

export function formatSlackAnswerConfirmation(channel: string, threadTs: string, token: string, chunks: string[]): SlackMessage {
  return slackTextMessage(channel, `Save this answer?\n${chunks.join("\n")}\nConfirm within 10 minutes.`, threadTs, [
    { type: "header", text: { type: "plain_text", text: "Save this answer?" } },
    ...chunks.map((text): KnownBlock => ({ type: "section", text: { type: "plain_text", text } })),
    slackContext("This saves your answer and may resume blocked work. Confirm within 10 minutes."),
    { type: "actions", elements: [
      { type: "button", action_id: "devhub_confirm_answer", value: token, text: { type: "plain_text", text: "Confirm" }, style: "primary" },
      { type: "button", action_id: "devhub_cancel_answer", value: token, text: { type: "plain_text", text: "Cancel" } },
    ] },
  ]);
}

function shortLine(value: string, max = 260): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function slackNeedUrl(item: Pick<SlackNeed, "href">): string {
  return slackDashboardUrl(item.href);
}

/** A plain (or primary) URL button to the item in DevHub. */
function openButton(url: string, primary: boolean, label = "Open") {
  return { type: "button" as const, action_id: "devhub_open", text: { type: "plain_text" as const, text: label }, url, ...(primary ? { style: "primary" as const } : {}) };
}

/**
 * Buttons by what the item is waiting on. One is primary: the answer or retry it is blocked on, else Open.
 * Plan and Implement go to a Confirm card (they start agents), so they only show on a task that isn't
 * waiting on a question or a retry; Open is a link and starts nothing.
 */
export function formatSlackNeed(item: SlackNeed, id: string, channel: string, threadTs?: string, resolution?: string, team = false): SlackMessage {
  if (resolution) return slackTextMessage(channel, `✅ ${resolution} · ${item.title}`, threadTs);
  if (item.action === "approve-plan" && item.plan) {
    const summary = item.plan.summary.length > 1200 ? clipSlackText(item.plan.summary, 1200).replace(/\s+\S*…$/, "…") : item.plan.summary;
    const message = slackTextMessage(channel, `Plan ready · ${item.title}\n${summary}`, threadTs, [
      { type: "header", text: { type: "plain_text", text: slackLine(item.title, 150) } },
      slackContext("Plan ready · waiting for your approval"),
      { type: "section", text: { type: "plain_text", text: summary } },
      { type: "actions", elements: [
        { type: "button", action_id: "devhub_approve_plan", value: id, text: { type: "plain_text", text: "Approve plan" }, style: "primary" },
        { type: "button", action_id: "devhub_revise_plan", value: id, text: { type: "plain_text", text: "Revise" } },
        openButton(slackNeedUrl(item), false, "Open in DevHub"),
      ] },
    ]);
    if (team && item.taskId) {
      message.blocks!.push(...teamTaskActions(item.taskId));
      message.taskRef = { profile: item.profile, taskId: item.taskId, title: item.title };
    }
    return message;
  }
  if (item.prRows) return slackTextMessage(channel, `${item.title} · ${item.prRows.length} need attention`, threadTs, compactPrNeedBlocks(item));
  const blocked = item.action !== "open";
  const startable = item.action === "open" && !!item.taskId;
  const message = formatSlackCard({ title: "Needs you", profile: item.profile, sections: [{ items: [{ title: item.title, href: slackNeedUrl(item), meta: item.needed }] }], href: blocked || startable ? undefined : slackNeedUrl(item) }, channel, threadTs);
  const url = slackNeedUrl(item);
  if (blocked) message.blocks!.push({
    type: "actions", elements: [
      { type: "button", action_id: item.action === "retry" ? "devhub_retry" : "devhub_answer", value: id, text: { type: "plain_text", text: item.action === "retry" ? "Retry" : "Answer" }, style: "primary" },
      openButton(url, false),
    ],
  });
  else if (startable) message.blocks!.push({
    type: "actions", elements: [
      { type: "button", action_id: "devhub_need_plan", value: id, text: { type: "plain_text", text: "Plan" } },
      { type: "button", action_id: "devhub_need_implement", value: id, text: { type: "plain_text", text: "Implement" } },
      openButton(url, true),
    ],
  });
  if (item.action === "answer" && item.options?.length) message.blocks!.push({
    type: "actions",
    elements: item.options.slice(0, 6).map((option, index) => ({
      type: "button", action_id: `devhub_answer_option_${index}`, value: id,
      text: { type: "plain_text", text: clipSlackText(option, 75) },
      // One stray click on a choice button should not answer for you.
      confirm: { title: { type: "plain_text", text: "Answer with this?" }, text: { type: "plain_text", text: clipSlackText(option, 300) }, confirm: { type: "plain_text", text: "Answer" }, deny: { type: "plain_text", text: "Cancel" } },
    })),
  });
  if (team && item.taskId) {
    message.blocks!.push(...teamTaskActions(item.taskId));
    message.taskRef = { profile: item.profile, taskId: item.taskId, title: item.title };
  }
  return message;
}

export function formatPlanRevisionModal(item: SlackNeed, id: string, token: string): ModalView & { blocks: KnownBlock[] } {
  return {
    type: "modal", callback_id: "devhub_submit_plan_revision", private_metadata: `${id}:${token}`,
    title: { type: "plain_text", text: "Revise plan" },
    submit: { type: "plain_text", text: "Request revision" }, close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "plain_text", text: slackLine(item.title, 300) } },
      { type: "input", block_id: "plan_revision", label: { type: "plain_text", text: "What should change?" },
        element: { type: "plain_text_input", action_id: "guidance", multiline: true, min_length: 1, max_length: 3000 } },
    ],
  };
}

export function formatSlackDigest(items: readonly SlackThreadItem[], channel: string): SlackMessage {
  if (items.length && items.every((item) => item.resolved)) return slackTextMessage(channel, "✅ Resolved in DevHub");
  const profile = items[0]?.profile ?? "";
  const open = items.filter((item) => !item.resolved).length;
  const entries = items.filter((item) => !item.prRows || item.resolved).map((item) => {
    const taskId = item.taskId && !item.jiraKey ? ` [${item.taskId}]` : "";
    return { title: `${shortLine(item.title, 90)}${taskId}`, href: slackNeedUrl(item), status: item.resolved ? "✅ resolved" : "👀 waiting", meta: item.resolved ? item.resolution ?? "Resolved" : item.needed };
  });
  const canAnswer = items.some((item) => !item.resolved && item.taskId && (item.action === "answer" || item.action === "repo"));
  const footer = canAnswer ? "Reply with a Jira key or task ID followed by : and your answer. Each task keeps its own thread." : "Open in DevHub to act on these items.";
  const href = homeSectionHref("needs-you", profile);
  const message = formatSlackCard({ title: "Needs you", profile, count: open, sections: [{ items: entries }], href, footer }, channel);
  const prs = items.filter((item) => item.prRows && !item.resolved);
  if (prs.length) message.blocks?.splice(1, 0, ...prs.flatMap(compactPrNeedBlocks));
  return message;
}

export function formatSlackRetryConfirmation(item: SlackThreadItem, token: string): SlackMessage {
  const label = shortLine(item.title, 160);
  const text = `Retry ${label}?\nThis resumes the failed work and may start an agent or grant one more fix round. Confirm within 5 minutes.`;
  const blocks: KnownBlock[] = [
    { type: "header", text: { type: "plain_text", text: "Confirm retry" } },
    { type: "section", text: { type: "mrkdwn", text: slackLink(`Retry ${label}?`, slackNeedUrl(item)), verbatim: true } },
    slackContext(escapeSlackText("This resumes the failed work and may start an agent or grant one more fix round. Confirm within 5 minutes.")),
    { type: "actions", elements: [
      { type: "button", action_id: "devhub_confirm_retry", value: token, text: { type: "plain_text", text: "Confirm retry" }, style: "primary" },
      { type: "button", action_id: "devhub_cancel_retry", value: token, text: { type: "plain_text", text: "Cancel" } },
    ] },
  ];
  return slackTextMessage(item.channel, text, item.thread_ts, blocks);
}

const PROGRESS_HEADLINES: Record<SlackMilestoneKind, string> = {
  "plan-ready": "📝 Plan ready", "pr-opened": "🔀 PR opened", "ready-for-review": "✅ Ready for review", failed: "⚠️ Run failed", "needs-input": "❓ Needs your input",
};
const PROGRESS_HINTS: Partial<Record<SlackMilestoneKind, string>> = { "plan-ready": "The plan run finished." };

/** One short line in the task's thread when its agent reaches a milestone, with the one link that matters. */
/** `verbatim: true` stops Slack auto-linking, so the PR and JIRA lines are linked explicitly (the copied plain text stays as is). */
function linkReviewRequestLines(text: string): string {
  return text
    .replace(/^PR: (https:\/\/\S+?)\/pull\/(\d+)$/gm, (line, base: string, number: string) => `PR: <${line.slice(4)}|${base.split("/").slice(-1)[0]}#${number}>`)
    .replace(/^JIRA: (https:\/\/\S+\/browse\/([A-Z][A-Z0-9_]*-\d+))$/gm, (_line, url: string, key: string) => `JIRA: <${url}|${key}>`);
}

export function formatSlackProgress(milestone: SlackMilestone, channel: string, threadTs: string): SlackMessage {
  const headline = PROGRESS_HEADLINES[milestone.kind];
  const detail = milestone.detail ? slackLine(milestone.detail, 300) : PROGRESS_HINTS[milestone.kind];
  const isPr = (milestone.kind === "pr-opened" || milestone.kind === "ready-for-review") && !!milestone.url;
  const href = isPr ? milestone.url! : taskHref(milestone.taskId, milestone.profile);
  const label = isPr ? "Open PR" : "Open in DevHub";
  // Ready for review carries the same request the PR rows copy, as mrkdwn so `repo` renders as code and the links work.
  const request = milestone.kind === "ready-for-review"
    ? linkReviewRequestLines(escapeSlackText(buildTaskReviewMessage({ repo: milestone.repo, title: milestone.title.replace(/^(\S+) · /, "$1 "), prUrl: milestone.url, jira: milestone.jira })))
    : null;
  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${headline}*`, verbatim: true } },
    ...(request ? [{ type: "section" as const, text: { type: "mrkdwn" as const, text: request, verbatim: true } }, slackContext("Forward this to ask for a review.")] : []),
    ...(detail && !request ? [slackContext(escapeSlackText(detail))] : []),
  ];
  // A PR link comes from GitHub data, so it only becomes a button when it is a plain http(s) URL.
  if (/^https?:\/\//.test(href) && href.length <= 2000) blocks.push({ type: "actions", elements: [openButton(href, true, label)] });
  return slackTextMessage(channel, `${headline} · ${slackLine(milestone.title, 160)}${detail ? ` — ${detail}` : ""}`, threadTs, blocks);
}

/** The thread root made for a task that has none yet: its title and a link, nothing else. */
export function formatSlackTaskRoot(milestone: Pick<SlackMilestone, "title" | "taskId" | "profile">, channel: string): SlackMessage {
  return formatSlackCard({ title: milestone.title, profile: milestone.profile, sections: [], href: taskHref(milestone.taskId, milestone.profile) }, channel);
}
