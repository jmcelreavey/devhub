import { z } from "zod";
import type { KnownBlock } from "@slack/web-api";
import type { SlackMessage } from "./client";
import type { SlackTool } from "./mcp-catalog";
import { clipSlackText, escapeSlackText, slackContext, slackLine, slackTextMessage, SLACK_LIMITS } from "./format";
import { slackToolRisk } from "./tool-risk";
import { capabilityGroups, matchingCapabilityGroups, type CapabilityGroup } from "./capabilities-groups";
import { toolSubcalls } from "./tool-options";
import { CAPABILITY_ACTIONS } from "./capabilities-route";

export const CAPABILITY_PAGE_SIZE = 18;
export interface CapabilityPageState { view: "overview" | "tools"; group?: string; page: number; profile?: string }
export interface CapabilityCardInput { channel: string; threadTs?: string; profile?: string; deviceLabel: string; tools?: readonly SlackTool[] }
const EXAMPLES: Record<string, string> = {
  jira_tickets: "my tickets", calendar_week: "meetings this week", briefing_get: "briefing", standup_markdown: "standup",
  jobs_list: "scheduled jobs", agent_runs: "agent runs", status_services: "services status", search: "search offline cache",
  tasks_capture: "add task Review the offline cache", tasks_agent_plan: "plan PTF-1", tasks_agent_resume: "implement PTF-1",
};

function section(text: string): KnownBlock { return { type: "section", text: { type: "mrkdwn", text, verbatim: true } }; }
function header(text: string): KnownBlock { return { type: "header", text: { type: "plain_text", text: slackLine(text, SLACK_LIMITS.header) } }; }
function footer(input: CapabilityCardInput): string { return `From ${slackLine(input.deviceLabel, 80)} · ${input.tools?.length ?? 0} tools · say “refresh tools” to reload`; }

export function capabilityPageValue(state: CapabilityPageState): string { return JSON.stringify({ v: 1, ...state }); }

const PageSchema = z.object({
  v: z.literal(1), view: z.enum(["overview", "tools"]), page: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  group: z.string().max(500).optional(), profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).optional(),
}).strict();

export function parseCapabilityPage(value: string | undefined): CapabilityPageState | undefined {
  if (!value || value.length > 2000) return undefined;
  try {
    const state = PageSchema.safeParse(JSON.parse(value));
    if (!state.success) return undefined;
    return { view: state.data.view, page: state.data.page, group: state.data.group, profile: state.data.profile };
  } catch { return undefined; }
}

function button(label: string, state: CapabilityPageState, index = 0) {
  return { type: "button" as const, action_id: CAPABILITY_ACTIONS[index], text: { type: "plain_text" as const, text: slackLine(label, 75) }, value: capabilityPageValue(state) };
}

export function toolRiskLabel(tool: SlackTool): string {
  const risk = slackToolRisk(tool, {});
  return risk.destructive ? "destructive · asks Confirm" : risk.confirm || tool.unrated ? "asks Confirm" : "read-only";
}

export function toolDescription(description: string): string {
  const line = description.replace(/\s+/g, " ").trim();
  // "e.g." / "i.e." / "etc." / "vs." don't end a sentence: mask their dots before finding the first full stop.
  const masked = line.replace(/\b(e\.g|i\.e|etc|vs)\./gi, (match) => match.replace(/\./g, "\u0000"));
  const sentence = (masked.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? masked).replace(/\u0000/g, ".");
  if (sentence.length <= 140) return sentence || "No description provided.";
  const prefix = sentence.slice(0, 139);
  const boundary = prefix.lastIndexOf(" ");
  return (boundary > 0 ? prefix.slice(0, boundary) : prefix) + "…";
}

function toolText(tool: SlackTool, subcall?: string): string {
  const example = EXAMPLES[tool.name];
  return `\`${escapeSlackText(tool.name).replace(/`/g, "ˋ")}\` · ${toolRiskLabel(tool)}\n${subcall ? "Sub-call: " + escapeSlackText(subcall) + "\n" : ""}${escapeSlackText(toolDescription(tool.description))}${example ? "\nTry: \x60" + escapeSlackText(example) + "\x60" : ""}`;
}

function groupHeading(group: CapabilityGroup): string {
  return (group.source === "core" ? "DevHub core · " : "") + slackLine(group.label, 150);
}

export function buildCapabilitiesOverview(input: CapabilityCardInput): SlackMessage {
  const groups = capabilityGroups(input.tools ?? []);
  const blocks: KnownBlock[] = [header("What DevHub can do"), section("Ask about tasks, Jira, PRs, agents, your calendar or notes — no model call needed for these quick commands.")];
  let summary = "";
  for (const group of groups) {
    const line = `*${escapeSlackText(slackLine(group.label, 120))}* · ${group.tools.length} ${group.tools.length === 1 ? "tool" : "tools"}\n`;
    if ((summary + line).length > SLACK_LIMITS.section) { blocks.push(section(summary.trim())); summary = ""; }
    summary += line;
  }
  if (summary) blocks.push(section(summary.trim()));
  if (!input.tools) blocks.push(section("The tool list couldn't be read. Say “refresh tools” to try again."));
  blocks.push(section("*Try saying*\n`needs me` · `my PRs` · `plan PTF-1` · `meetings today` · `add task …` · `worktrees`"),
    slackContext("Add “in work” or “in personal” to scope a query. Task threads keep their original profile."),
    slackContext("Reads run straight away. Changes ask you to Confirm. Reply in a task thread to answer its oldest open question."));
  const choices = [{ label: "All tools", group: undefined }, ...groups.map((group) => ({ label: group.label, group: group.id }))];
  for (let offset = 0; offset < choices.length; offset += 25) blocks.push({ type: "actions", elements: choices.slice(offset, offset + 25).map((choice, index) => button(choice.label, { view: "tools", group: choice.group, page: 0, profile: input.profile }, index)) });
  blocks.push(slackContext(escapeSlackText(footer(input))));
  return slackTextMessage(input.channel, ["What DevHub can do", ...groups.map((group) => group.label + " · " + group.tools.length), !input.tools ? "The tool list couldn't be read. Try refresh tools." : "", "Try: needs me · my PRs · plan PTF-1 · meetings today · add task … · worktrees", footer(input)].join("\n"), input.threadTs, blocks);
}

export function buildCapabilitiesPage(input: CapabilityCardInput, state: CapabilityPageState): SlackMessage {
  if (!input.tools) return buildCapabilitiesOverview(input);
  const groups = matchingCapabilityGroups(capabilityGroups(input.tools), state.group);
  const entries = groups.flatMap((group) => group.tools.flatMap((tool) => [
    { group, tool, subcall: undefined as string | undefined },
    ...toolSubcalls(tool).map((call) => ({ group, tool, subcall: call.label })),
  ]));
  const pages = Math.max(1, Math.ceil(entries.length / CAPABILITY_PAGE_SIZE));
  if (state.page >= pages) return slackTextMessage(input.channel, "That tools page is no longer available. Say “tools” to start again.", input.threadTs);
  const title = `Tools · ${state.page + 1} of ${pages}`;
  const blocks: KnownBlock[] = [header(title)];
  const fallback = [title];
  let previous: string | undefined;
  for (const { group, tool, subcall } of entries.slice(state.page * CAPABILITY_PAGE_SIZE, (state.page + 1) * CAPABILITY_PAGE_SIZE)) {
    if (previous !== group.id) { blocks.push(section("*" + escapeSlackText(groupHeading(group)) + "*")); previous = group.id; }
    blocks.push(section(clipSlackText(toolText(tool, subcall), SLACK_LIMITS.section)));
    fallback.push(tool.name + (subcall ? " · " + subcall : "") + " · " + toolRiskLabel(tool) + " — " + toolDescription(tool.description));
  }
  if (!entries.length) blocks.push(section("No matching tools on this DevHub. Say “tools” for the full list or “refresh tools” to reload."));
  if (state.page + 1 < pages) blocks.push({ type: "actions", elements: [button(`More (page ${state.page + 2} of ${pages})`, { view: "tools", group: state.group && groups.length === 1 ? groups[0].id : state.group, page: state.page + 1, profile: input.profile })] });
  blocks.push(slackContext(escapeSlackText(footer(input))));
  fallback.push(footer(input));
  return slackTextMessage(input.channel, fallback.join("\n"), input.threadTs, blocks);
}
