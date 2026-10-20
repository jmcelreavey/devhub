import type { SlackTool } from "./mcp-catalog";

/**
 * Slack's own view of how risky a tool call is. The MCP annotations describe the tool for every
 * client; from Slack a mistap is cheap and silent, so some tools are rated stricter here. The MCP
 * server and its annotations are never touched: this only decides when Slack asks, and how loudly.
 */
export interface SlackRisk {
  /** Needs the Confirm card (false: a plain read that runs straight away). */
  confirm: boolean;
  /** Red button and "can't be undone" wording. */
  destructive: boolean;
}

const READ: SlackRisk = { confirm: false, destructive: false };
const WRITE: SlackRisk = { confirm: true, destructive: false };
const DESTRUCTIVE: SlackRisk = { confirm: true, destructive: true };

/** Annotated read-only but starts something (an agent run, a model call): always Confirm. */
const READ_ONLY_WITH_SIDE_EFFECTS = new Set(["datadog_investigate", "repo_learn", "task_ask_teammate"]);

/** Starts, kills or reconfigures agents, jobs and scripts, or runs SQL: red Confirm whatever the annotation says. */
const ALWAYS_DESTRUCTIVE = new Set([
  "scripts_run", "agent_dispatch", "agent_race", "agent_followup", "agent_cancel",
  "jobs_create", "jobs_update", "jobs_delete", "jobs_run",
  "db_execute", "db_cancel",
  "task_handoff",
]);

/** Rate by the `action` argument. A missing or unknown action is treated as destructive. */
const BY_ACTION: Record<string, { read: readonly string[]; write: readonly string[]; defaultAction?: string }> = {
  repos_git_worktrees: { read: ["list", "review"], write: ["add", "prune", "lock", "unlock"], defaultAction: "list" },
  repos_git_branch: { read: [], write: ["checkout", "create-branch", "fetch", "pull"] },
  repos_git_stash: { read: ["list", "show"], write: ["save", "apply"] },
};

/** True when the tool can only ever read, from Slack's point of view. */
export function slackReadOnly(tool: Pick<SlackTool, "name" | "readOnly">): boolean {
  return tool.readOnly && !READ_ONLY_WITH_SIDE_EFFECTS.has(tool.name) && !ALWAYS_DESTRUCTIVE.has(tool.name) && !(tool.name in BY_ACTION);
}

/** The tool's flags with Slack's overrides applied. Used when the catalog is loaded. */
export function applySlackToolRisk<Tool extends Pick<SlackTool, "name" | "readOnly" | "destructive">>(tool: Tool): Tool {
  if (ALWAYS_DESTRUCTIVE.has(tool.name)) return { ...tool, readOnly: false, destructive: true };
  if (READ_ONLY_WITH_SIDE_EFFECTS.has(tool.name)) return { ...tool, readOnly: false, destructive: false };
  if (tool.name in BY_ACTION) return { ...tool, readOnly: false };
  return tool;
}

/** What this exact call needs. `args` are the arguments about to be sent. */
export function slackToolRisk(tool: Pick<SlackTool, "name" | "readOnly" | "destructive" | "plugin" | "server" | "originalName">, args: Record<string, unknown>): SlackRisk {
  if (tool.plugin || (tool.server && tool.server !== "devhub")) {
    const name = tool.originalName ?? tool.name;
    if (ALWAYS_DESTRUCTIVE.has(name)) return DESTRUCTIVE;
    if (READ_ONLY_WITH_SIDE_EFFECTS.has(name)) return WRITE;
    // Core-only read exceptions must never turn an unrelated server\'s write into a read.
    return tool.readOnly ? READ : tool.destructive ? DESTRUCTIVE : WRITE;
  }
  if (tool.name === "task_note_add") return args.updateAgent === true ? WRITE : READ;
  if (ALWAYS_DESTRUCTIVE.has(tool.name)) return DESTRUCTIVE;
  if (READ_ONLY_WITH_SIDE_EFFECTS.has(tool.name)) return WRITE;
  // Listing and a dry run only look; removing folders is the one red call. Missing action means list.
  if (tool.name === "repos_worktree_cleanup") return (args.action ?? "list") === "list" || args.dryRun === true ? READ : DESTRUCTIVE;
  const rule = BY_ACTION[tool.name];
  if (rule) {
    const action = typeof args.action === "string" ? args.action : rule.defaultAction;
    if (action && rule.read.includes(action)) return READ;
    if (action && rule.write.includes(action)) return WRITE;
    return DESTRUCTIVE;
  }
  if (tool.readOnly) return READ;
  return tool.destructive ? DESTRUCTIVE : WRITE;
}
