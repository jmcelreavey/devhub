import { createHash } from "node:crypto";
import type { SlackTool } from "./mcp-catalog";

export interface CapabilityGroup {
  id: string;
  label: string;
  source: "core" | "plugin" | "server";
  aliases: string[];
  tools: SlackTool[];
}

const TOOLSET_LABELS: Record<string, string> = {
  tasks: "Tasks", plans: "Storyboard & Auto", storyboard: "Storyboard & Auto",
  work: "PRs & GitHub", repos: "Worktrees & Repos", ownership: "Worktrees & Repos", ship: "Worktrees & Repos",
  agents: "Agents", sessions: "Agents", jobs: "Agents", scripts: "Agents",
  calendar: "Calendar", briefing: "Calendar", notes: "Notes", docs: "Notes", search: "Notes", recall: "Notes", share: "Notes", diagrams: "Notes",
  datadog: "Datadog", team: "Team", jira: "Jira", prs: "PRs & GitHub",
  appraisal: "Other", "dx-audit": "Other", history: "Other", resources: "Other", status: "Other", integrations: "Other",
  editor: "Other", plugins: "Other", assets: "Other", capability: "Other", workspace: "Other", voice: "Other", terminal: "Other", db: "Other", events: "Other", ui: "Other",
};
const GROUP_ORDER = ["Tasks", "Storyboard & Auto", "Jira", "PRs & GitHub", "Agents", "Worktrees & Repos", "Calendar", "Notes", "Datadog", "Team", "Other"];

function coreLabel(tool: SlackTool): string {
  if (/^(?:task_ask_teammate|task_handoff|integrations_slack)/.test(tool.name)) return "Team";
  if (/^(?:tasks?_|task_note_|tasks_agent_)/.test(tool.name)) return "Tasks";
  if (/^storyboard_/.test(tool.name)) return "Storyboard & Auto";
  if (/^jira_/.test(tool.name)) return "Jira";
  if (/^prs_/.test(tool.name)) return "PRs & GitHub";
  return TOOLSET_LABELS[tool.category] ?? tool.category.replace(/[-_]+/g, " ").replace(/^./, (first) => first.toUpperCase());
}

/** Match whole keywords, never substrings such as "the" in "Other". */
export function keywordCapabilityGroup(groups: readonly CapabilityGroup[], text: string): CapabilityGroup | undefined {
  const tokens = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu)?.map((word) => word.replace(/s$/, "")) ?? [];
  const words = new Set(tokens(text));
  const generic = new Set(["plugin", "mcp", "other", "auto", "tool"]);
  const matches = groups.filter((group) => tokens(group.label).some((word) => word.length >= 3 && !generic.has(word) && words.has(word)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function capabilityGroups(tools: readonly SlackTool[]): CapabilityGroup[] {
  const groups = new Map<string, CapabilityGroup>();
  for (const tool of tools) {
    const source = tool.plugin ? "plugin" : tool.server && tool.server !== "devhub" ? "server" : "core";
    const label = source === "plugin" ? "Plugin: " + tool.plugin : source === "server" ? "MCP: " + tool.server : coreLabel(tool);
    const id = createHash("sha256").update(source + ":" + label).digest("hex").slice(0, 24);
    let group = groups.get(id);
    if (!group) { group = { id, label, source, aliases: [id, label], tools: [] }; groups.set(id, group); }
    group.aliases.push(tool.category, ...(tool.plugin ? [tool.plugin] : []), ...(tool.server ? [tool.server] : []));
    group.tools.push(tool);
  }
  const sourceOrder = { core: 0, plugin: 1, server: 2 };
  return [...groups.values()].sort((left, right) => sourceOrder[left.source] - sourceOrder[right.source]
    || (left.source === "core" ? (GROUP_ORDER.indexOf(left.label) < 0 ? GROUP_ORDER.length : GROUP_ORDER.indexOf(left.label)) - (GROUP_ORDER.indexOf(right.label) < 0 ? GROUP_ORDER.length : GROUP_ORDER.indexOf(right.label)) : 0)
    || left.label.localeCompare(right.label)).map((group) => ({ ...group, tools: group.tools.sort((left, right) => left.name.localeCompare(right.name)) }));
}

function matchKey(value: string): string { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }

export function matchingCapabilityGroups(groups: readonly CapabilityGroup[], query?: string): CapabilityGroup[] {
  if (!query) return [...groups];
  const exact = groups.filter((group) => group.aliases.some((alias) => matchKey(alias) === matchKey(query)));
  if (exact.length) return exact;
  const words = matchKey(query).split(" ").filter(Boolean);
  return words.length ? groups.filter((group) => group.aliases.some((alias) => words.every((word) => matchKey(alias).includes(word)))) : [];
}
