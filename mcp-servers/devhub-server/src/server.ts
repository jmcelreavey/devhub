/**
 * Builds the DevHub MCP server: every tool group, skill prompts, call history,
 * and toolset selection. Shared by the stdio entry (mcp.ts) and the HTTP entry
 * (http.ts) so both transports expose exactly the same thing.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "./context.ts";
import {
  createFileRecorder,
  historyEnabled,
  instrumentToolHistory,
  mcpHistoryDir,
  pruneMcpHistory,
} from "./history.ts";
import { instrumentToolAnnotations } from "./annotations.ts";
import { selectToolsets, type ToolsetSelection } from "./toolsets.ts";
import { registerNotesTools } from "./tools/notes.ts";
import { registerDocsTools } from "./tools/docs.ts";
import { registerTasksTools } from "./tools/tasks.ts";
import { registerDiagramsTools } from "./tools/diagrams.ts";
import { registerAppraisalTools } from "./tools/appraisal.ts";
import { registerDxAuditTools } from "./tools/dx-audit.ts";
import { registerShipTools } from "./tools/ship.ts";
import { registerStatusTools } from "./tools/status.ts";
import { registerBriefingTools } from "./tools/briefing.ts";
import { registerCalendarTools } from "./tools/calendar.ts";
import { registerWorkTools } from "./tools/work.ts";
import { registerAssetsTools } from "./tools/assets.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerScriptsTools } from "./tools/scripts.ts";
import { registerReposTools } from "./tools/repos.ts";
import { registerDatadogTools } from "./tools/datadog.ts";
import { registerCapabilityTools } from "./tools/capability.ts";
import { registerSessionTools } from "./tools/sessions.ts";
import { registerRecallTools } from "./tools/recall.ts";
import { registerTagsTools } from "./tools/tags.ts";
import { registerShareTools } from "./tools/share.ts";
import { registerWorkspaceTools } from "./tools/workspace.ts";
import { registerOwnershipTools } from "./tools/ownership.ts";
import { registerTerminalTools } from "./tools/terminal.ts";
import { registerDbTools } from "./tools/db.ts";
import { registerAgentTools } from "./tools/agents.ts";
import { registerJobsTools } from "./tools/jobs.ts";
import { registerResourceTools } from "./tools/resources.ts";
import { registerHistoryTools } from "./tools/history.ts";
import { registerRaceVerdictPrompt, registerSkillPrompts } from "./tools/prompts.ts";
import { registerEventTools } from "./tools/events.ts";
import { registerUiTools } from "./tools/ui.ts";

/**
 * Sent to clients at initialize; harnesses such as Claude Code put this in the
 * model's context. Only rules that should override a harness's own habits
 * belong here — tool descriptions carry the rest.
 */
export const SERVER_INSTRUCTIONS = [
  "DevHub is the user's local developer hub: notes, tasks, repos, PRs, agent runs, a terminal dock and scheduled jobs.",
  "- Scheduling: when the user wants something to happen later or on a recurring schedule and it involves DevHub (a DevHub script, or an agent prompt in one of their repos), create a DevHub scheduled job with jobs_create instead of your own cron, loop or scheduled-task tools. DevHub jobs persist across restarts, catch up after sleep, can wake the Mac, and are visible on DevHub's Actions page.",
  "- Long-running or user-visible commands belong in the DevHub terminal dock (terminal_propose_run), not your own shell.",
  "- Dashboard-backed tools need the DevHub dashboard running; an 'unreachable' error means start it, not that the tool is broken.",
].join("\n");

/** Toolset name → registrar. Selectable with DEVHUB_MCP_TOOLSETS (see toolsets.ts). */
const TOOLSETS: Record<string, (server: McpServer, ctx: Context) => void> = {
  // Filesystem-backed (work headless, no dashboard required).
  notes: registerNotesTools,
  docs: registerDocsTools,
  tasks: registerTasksTools,
  diagrams: registerDiagramsTools,
  appraisal: registerAppraisalTools,
  "dx-audit": registerDxAuditTools,
  ship: registerShipTools,
  history: registerHistoryTools,
  prompts: (server, ctx) => {
    registerSkillPrompts(server, ctx);
    // A workflow prompt, not a skill — lives in the same slash-command surface.
    registerRaceVerdictPrompt(server);
  },

  // Dashboard-backed (proxy localhost:1337; need the dashboard running).
  resources: registerResourceTools,
  status: registerStatusTools,
  jobs: registerJobsTools,
  briefing: registerBriefingTools,
  calendar: registerCalendarTools,
  work: registerWorkTools,
  assets: registerAssetsTools,
  search: registerSearchTools,
  scripts: registerScriptsTools,
  repos: registerReposTools,
  ownership: registerOwnershipTools,
  datadog: registerDatadogTools,
  capability: registerCapabilityTools,
  sessions: registerSessionTools,
  recall: registerRecallTools,
  tags: registerTagsTools,
  share: registerShareTools,
  workspace: registerWorkspaceTools,
  terminal: registerTerminalTools,
  db: registerDbTools,
  agents: registerAgentTools,
  events: registerEventTools,
  ui: registerUiTools,
};

export const TOOLSET_NAMES: readonly string[] = Object.keys(TOOLSETS);

/** Sent to clients at initialize; keep in one place so status_mcp can self-report it. */
export const SERVER_VERSION = "4.0.0";

/** Once per process (not per HTTP session): report bad toolset names, prune old history. */
export function startupHousekeeping(env: NodeJS.ProcessEnv = process.env): void {
  const { unknown } = selectToolsets(env.DEVHUB_MCP_TOOLSETS, TOOLSET_NAMES);
  if (unknown.length > 0) {
    console.error(
      `DEVHUB_MCP_TOOLSETS: ignoring unknown toolset(s) ${unknown.join(", ")}. Known: ${TOOLSET_NAMES.join(", ")}`,
    );
  }
  if (historyEnabled(env)) {
    const keepDays = Number.parseInt(env.DEVHUB_MCP_HISTORY_DAYS ?? "", 10);
    pruneMcpHistory(mcpHistoryDir(env), Number.isFinite(keepDays) ? keepDays : 30);
  }
}

export function createDevhubMcpServer(
  ctx: Context,
  env: NodeJS.ProcessEnv = process.env,
): { server: McpServer; toolsets: ToolsetSelection } {
  const server = new McpServer({ name: "devhub", version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  // Annotate before registering: every tool gets readOnly/destructive/idempotent/
  // openWorld hints (src/annotations.ts) unless a registrar set its own.
  instrumentToolAnnotations(server);

  // Instrument before registering, so every tool lands in the day's history file.
  let registeringToolset: string | null = null;
  if (historyEnabled(env)) {
    instrumentToolHistory(server, {
      recorder: createFileRecorder(mcpHistoryDir(env)),
      currentToolset: () => registeringToolset,
    });
  }

  const toolsets = selectToolsets(env.DEVHUB_MCP_TOOLSETS, TOOLSET_NAMES);
  for (const name of toolsets.names) {
    registeringToolset = name;
    TOOLSETS[name]?.(server, ctx);
  }
  registeringToolset = null;
  return { server, toolsets };
}
