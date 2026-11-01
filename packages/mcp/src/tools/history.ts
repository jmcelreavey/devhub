import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpHistory, mcpHistorySummary } from "../../../../packages/shared/actions/history.ts";
import { registerAction } from "../actions/register.ts";
import {
  describeArgs,
  localDate,
  mcpHistoryDir,
  readMcpHistory,
  summarizeMcpHistory,
  type McpHistoryEntry,
  type McpHistorySummary,
} from "../history.ts";

/**
 * Read back the MCP call history (see ../history.ts). Filesystem-backed, so it
 * works without the dashboard — the point is to see what happened even when
 * something else was broken.
 */

const MAX_ACTIONS_SHOWN = 60;
const MAX_ERRORS_SHOWN = 20;

function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

function formatDuration(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${ms}ms`;
}

export function formatHistoryEntry(entry: McpHistoryEntry): string {
  const head = [
    clock(entry.ts),
    entry.tool,
    entry.ok ? "ok" : "FAILED",
    formatDuration(entry.durationMs),
    entry.client ? `[${entry.client}]` : null,
    entry.agentRunId ? `run=${entry.agentRunId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const args = entry.args === null || entry.args === undefined ? "" : `\n    args: ${JSON.stringify(entry.args).slice(0, 400)}`;
  const error = entry.error ? `\n    error: ${entry.error}` : "";
  return `${head}${args}${error}`;
}

export function formatHistorySummary(summary: McpHistorySummary): string {
  if (summary.total === 0) return `No DevHub MCP calls recorded for ${summary.date}.`;
  const span = summary.firstTs && summary.lastTs ? ` (${clock(summary.firstTs).slice(0, 5)}–${clock(summary.lastTs).slice(0, 5)})` : "";
  const lines = [
    `DevHub MCP activity for ${summary.date}${span}`,
    `${summary.total} calls · ${summary.failed} failed`,
    `Clients: ${summary.clients.map((c) => `${c.client} (${c.count})`).join(", ")}`,
    `Groups: ${summary.toolsets.map((t) => `${t.toolset} ${t.count}`).join(", ")}`,
    `Top tools: ${summary.tools
      .slice(0, 10)
      .map((t) => `${t.tool} ${t.count}${t.failed ? ` (${t.failed} failed)` : ""}`)
      .join(", ")}`,
  ];

  if (summary.actions.length > 0) {
    lines.push("", `Actions (${summary.actions.length}):`);
    for (const action of summary.actions.slice(0, MAX_ACTIONS_SHOWN)) {
      lines.push(`- ${clock(action.ts).slice(0, 5)} ${action.tool}${action.detail ? ` ${action.detail}` : ""}${action.ok ? "" : " — FAILED"}`);
    }
    if (summary.actions.length > MAX_ACTIONS_SHOWN) {
      lines.push(`- … ${summary.actions.length - MAX_ACTIONS_SHOWN} more (mcp_history for the full trace)`);
    }
  }

  if (summary.errors.length > 0) {
    lines.push("", `Failures (${summary.errors.length}):`);
    for (const error of summary.errors.slice(0, MAX_ERRORS_SHOWN)) {
      lines.push(`- ${clock(error.ts).slice(0, 5)} ${error.tool}: ${error.error}`);
    }
  }

  if (summary.agentRunIds.length > 0) {
    lines.push("", `Calls made by dispatched agent runs: ${summary.agentRunIds.join(", ")}`);
  }
  return lines.join("\n");
}

export function registerHistoryTools(server: McpServer): void {
  const context = {
    today: () => localDate(Date.now()),
    read: (date: string, filters: { tool?: string; errorsOnly?: boolean; agentRunId?: string; client?: string }) => readMcpHistory(mcpHistoryDir(), date, filters),
    summarize: (date: string, entries: unknown[]) => summarizeMcpHistory(date, entries as McpHistoryEntry[]),
  };
  registerAction(server, mcpHistory, context, (result) => {
      const shown = result.entries as McpHistoryEntry[];
      const text =
        shown.length === 0
          ? `No matching DevHub MCP calls on ${result.date}.`
          : `${result.total} matching call(s) on ${result.date}${shown.length < result.total ? `, newest ${shown.length} shown` : ""}:\n\n${shown.map(formatHistoryEntry).join("\n")}`;
      return { content: [{ type: "text", text }] };
  });
  registerAction(server, mcpHistorySummary, context, (summary) => ({
    content: [{ type: "text", text: formatHistorySummary(summary as McpHistorySummary) }],
  }));
}

export { describeArgs };
