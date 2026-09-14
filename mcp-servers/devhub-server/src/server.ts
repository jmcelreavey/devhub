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
import { registerHistoryTools } from "./tools/history.ts";
import { registerSkillPrompts } from "./tools/prompts.ts";
import { registerEventTools } from "./tools/events.ts";

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
  prompts: registerSkillPrompts,

  // Dashboard-backed (proxy localhost:1337; need the dashboard running).
  status: registerStatusTools,
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
};

export const TOOLSET_NAMES: readonly string[] = Object.keys(TOOLSETS);

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
  const server = new McpServer({ name: "devhub", version: "4.0.0" });

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
