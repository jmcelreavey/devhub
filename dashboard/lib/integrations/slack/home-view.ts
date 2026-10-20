import type { KnownBlock } from "@slack/web-api";
import type { SlackHomeView } from "./client";
import { escapeSlackText, slackContext, slackDashboardUrl, slackLine, slackLink, slackStatusLabel } from "./format";
import { compactPrNeedBlocks, slackNeedUrl } from "./needs-you-format";
import type { SlackNeed } from "./needs-you-source";
import { PR_SECTIONS, rowBlock, type PrRow, type PrSections } from "./pr-view";
import { taskHref } from "./quick-tasks";

export const HOME_NEEDS_LIMIT = 8;
export const HOME_PRS_LIMIT = 3;
export const HOME_TASKS_LIMIT = 6;

const PR_TITLES = { mine: "Mine", review: "Review requested", owned: "Owned repos" } as const;

export interface SlackHomeTask { taskId: string; title: string; status: string }

export interface SlackHomeInput {
  profile: string;
  /** The configured channel, where Plan and Implement post their Confirm card. */
  channel: string;
  /** Undefined when the task sources couldn't be read: the view says so instead of showing an empty list. */
  needs?: ReadonlyArray<{ id: string; need: SlackNeed }>;
  tasks?: readonly SlackHomeTask[];
  /** Undefined when GitHub couldn't be read; `configured: false` when the CLI isn't signed in. */
  prs?: { configured: boolean; sections: PrSections; stale: boolean; actionableCount?: number };
  now: number;
}

function openButton(url: string, primary: boolean) {
  return { type: "button" as const, action_id: "devhub_open", text: { type: "plain_text" as const, text: "Open" }, url, ...(primary ? { style: "primary" as const } : {}) };
}

function needBlocks({ id, need }: { id: string; need: SlackNeed }): KnownBlock[] {
  if (need.prRows) return compactPrNeedBlocks(need);
  const url = slackNeedUrl(need);
  // Only work that is waiting to be picked up can be planned or implemented; an answer or a retry is handled where the question is.
  const startable = need.action === "open" && !!need.taskId;
  return [
    { type: "section", text: { type: "mrkdwn", text: slackLink(need.title, url), verbatim: true } },
    slackContext(escapeSlackText(slackLine(need.needed, 200))),
    { type: "actions", elements: startable
      ? [
        { type: "button", action_id: "devhub_need_plan", value: id, text: { type: "plain_text", text: "Plan" } },
        { type: "button", action_id: "devhub_need_implement", value: id, text: { type: "plain_text", text: "Implement" } },
        openButton(url, true),
      ]
      : need.action === "retry" && need.taskId ? [
        { type: "button", action_id: "devhub_retry", value: id, text: { type: "plain_text", text: "Retry" }, style: "primary" },
        openButton(url, false),
      ] : [openButton(url, true)] },
  ];
}

function prBlocks(prs: NonNullable<SlackHomeInput["prs"]>): KnownBlock[] {
  if (!prs.configured) return [slackContext("The GitHub CLI isn't signed in, so PRs can't be listed. Run gh auth login.")];
  const counts = PR_SECTIONS.map((id) => `${PR_TITLES[id]} ${prs.sections[id].length}`).join(" · ");
  // The few that matter most: failing CI first, then my own and review requests before the wider Owned list.
  const rows: PrRow[] = PR_SECTIONS.flatMap((id) => prs.sections[id]);
  const top = [...rows.filter((row) => row.failing), ...rows.filter((row) => !row.failing)].slice(0, HOME_PRS_LIMIT);
  return [
    slackContext(escapeSlackText(counts)),
    ...top.map(rowBlock),
    ...(prs.stale ? [slackContext("GitHub was slow, so this is the last list DevHub had.")] : []),
    { type: "actions", elements: [{ type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "All PRs" }, url: slackDashboardUrl("/prs") }] },
  ];
}

/** Where Plan and Implement answer: a Home click has no message to reply to, so it is the configured channel. */
function confirmNote(channel: string): string {
  const where = /^[CG][A-Z0-9]+$/.test(channel) ? `<#${channel}>` : "your chat with DevHub";
  return `${escapeSlackText("Plan, Implement and Retry post a Confirm card in ")}${where}${escapeSlackText(" — nothing starts until you confirm there.")}`;
}

function heading(text: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text: `*${escapeSlackText(text)}*`, verbatim: true } };
}

/** The live Needs-you dashboard: counts, the Needs-you cards, a compact PR summary, today's tasks and Refresh. */
export function buildHomeView(input: SlackHomeInput): SlackHomeView {
  const needs = input.needs ?? [];
  const prTotal = input.prs?.configured ? input.prs.actionableCount : undefined;
  const summary = [
    input.needs ? `${needs.length} need${needs.length === 1 ? "s" : ""} you` : "Needs-you unavailable",
    prTotal === undefined ? undefined : `${prTotal} PR${prTotal === 1 ? "" : "s"} need attention`,
    input.tasks ? `${input.tasks.length} task${input.tasks.length === 1 ? "" : "s"} today` : undefined,
  ].filter(Boolean).join(" · ");
  const blocks: KnownBlock[] = [
    { type: "header", text: { type: "plain_text", text: slackLine(`DevHub · ${input.profile}`, 150) } },
    slackContext(escapeSlackText(summary)),
    { type: "actions", elements: [
      { type: "button", action_id: "devhub_tool_capabilities_home", text: { type: "plain_text", text: "What I can do" } },
      { type: "button", action_id: "devhub_home_refresh", text: { type: "plain_text", text: "Refresh" } },
      { type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "Open DevHub" }, url: slackDashboardUrl("/") },
    ] },
    slackContext(confirmNote(input.channel)),
    { type: "divider" },
    heading(`Needs you · ${input.needs ? needs.length : "?"}`),
  ];
  if (!input.needs) blocks.push(slackContext("Some task sources couldn't be read, so this list isn't shown. Open DevHub to check them."));
  else if (!needs.length) blocks.push({ type: "section", text: { type: "plain_text", text: "Nothing is waiting on you." } });
  for (const entry of needs.slice(0, HOME_NEEDS_LIMIT)) blocks.push(...needBlocks(entry));
  if (needs.length > HOME_NEEDS_LIMIT) blocks.push(slackContext(`+${needs.length - HOME_NEEDS_LIMIT} more · ${slackLink("Open in DevHub", slackDashboardUrl("/"))}`));
  blocks.push({ type: "divider" }, heading("Pull requests"));
  blocks.push(...(input.prs ? prBlocks(input.prs) : [slackContext("Couldn't read your PRs just now. Open DevHub to check.")]));
  blocks.push({ type: "divider" }, heading(`Today's tasks · ${input.tasks ? input.tasks.length : "?"}`));
  if (!input.tasks) blocks.push(slackContext("Couldn't read today's tasks just now."));
  else if (!input.tasks.length) blocks.push({ type: "section", text: { type: "plain_text", text: "No tasks planned for today." } });
  for (const task of (input.tasks ?? []).slice(0, HOME_TASKS_LIMIT)) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `${escapeSlackText(slackStatusLabel(task.status))} · ${slackLink(task.title, taskHref(task.taskId, input.profile))}`, verbatim: true } });
  }
  if ((input.tasks?.length ?? 0) > HOME_TASKS_LIMIT) blocks.push(slackContext(`+${input.tasks!.length - HOME_TASKS_LIMIT} more in DevHub`));
  const seconds = Math.floor(input.now / 1000);
  blocks.push(slackContext(`Updated <!date^${seconds}^{time}|${new Date(input.now).toISOString().slice(11, 16)} UTC> · press Refresh to update`));
  return { type: "home", blocks };
}

/** What anyone but the configured user sees. */
export function buildPrivateHomeView(): SlackHomeView {
  return { type: "home", blocks: [
    { type: "header", text: { type: "plain_text", text: "This DevHub is private" } },
    { type: "section", text: { type: "plain_text", text: "This app belongs to one person and only answers to them. Nothing here is shared." } },
  ] };
}
