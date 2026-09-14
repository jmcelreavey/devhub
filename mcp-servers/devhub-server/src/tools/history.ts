import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  describeArgs,
  isHistoryDate,
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

const dateSchema = z
  .string()
  .refine(isHistoryDate, "YYYY-MM-DD")
  .optional()
  .describe("Local day, YYYY-MM-DD (default today)");

export function registerHistoryTools(server: McpServer): void {
  server.registerTool(
    "mcp_history",
    {
      description:
        "Trace DevHub MCP tool calls: every call any agent made through this server on a given day, newest first, with redacted arguments, duration, outcome, client, and the dispatched agent run that made it. Use for debugging and 'what exactly happened'. Works without the dashboard.",
      inputSchema: {
        date: dateSchema,
        tool: z.string().optional().describe("Exact tool name, or a prefix ending in * (e.g. agent_*)"),
        errorsOnly: z.boolean().optional(),
        agentRunId: z.string().optional().describe("Only calls made by this dispatched agent run"),
        client: z.string().optional().describe("Substring of the client name, e.g. claude or cursor"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 50"),
      },
    },
    async ({ date, tool, errorsOnly, agentRunId, client, limit }) => {
      const day = date ?? localDate(Date.now());
      const entries = readMcpHistory(mcpHistoryDir(), day, { tool, errorsOnly, agentRunId, client });
      const shown = entries.slice(-(limit ?? 50)).reverse();
      const text =
        shown.length === 0
          ? `No matching DevHub MCP calls on ${day}.`
          : `${entries.length} matching call(s) on ${day}${shown.length < entries.length ? `, newest ${shown.length} shown` : ""}:\n\n${shown.map(formatHistoryEntry).join("\n")}`;
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "mcp_history_summary",
    {
      description:
        "Summarise a day of DevHub MCP activity: call totals, clients, busiest groups and tools, the actions taken (notes written, tasks changed, commits, agent runs dispatched…) and failures. Use for end-of-day recaps and standups. Works without the dashboard.",
      inputSchema: { date: dateSchema },
    },
    async ({ date }) => {
      const day = date ?? localDate(Date.now());
      const summary = summarizeMcpHistory(day, readMcpHistory(mcpHistoryDir(), day));
      return { content: [{ type: "text", text: formatHistorySummary(summary) }] };
    },
  );
}

export { describeArgs };
