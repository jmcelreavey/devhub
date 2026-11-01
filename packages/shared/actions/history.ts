import { z } from "zod";
import { defineAction } from "./define.ts";

export const mcpHistoryInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional().describe("Local day, YYYY-MM-DD (default today)"),
  tool: z.string().optional().describe("Exact tool name, or a prefix ending in * (e.g. agent_*)"),
  errorsOnly: z.boolean().optional(),
  agentRunId: z.string().optional().describe("Only calls made by this dispatched agent run"),
  client: z.string().optional().describe("Substring of the client name, e.g. claude or cursor"),
  limit: z.number().int().min(1).max(500).optional().describe("Default 50"),
}).meta({ additionalProperties: false });

export interface McpHistoryContext {
  today: () => string;
  read: (date: string, filters: Omit<z.output<typeof mcpHistoryInput>, "date" | "limit">) => unknown[];
  summarize: (date: string, entries: unknown[]) => unknown;
  limit?: number;
}

export interface McpHistoryResult {
  date: string;
  total: number;
  summary: unknown;
  entries: unknown[];
}

export const mcpHistory = defineAction<typeof mcpHistoryInput, McpHistoryContext, McpHistoryResult>({
  input: mcpHistoryInput,
  http: { method: "GET", path: "/api/mcp-history" },
  mcp: {
    name: "mcp_history",
    toolset: "history",
    description: "Trace DevHub MCP tool calls: every call any agent made through this server on a given day, newest first, with redacted arguments, duration, outcome, client, and the dispatched agent run that made it. Use for debugging and \u0027what exactly happened\u0027. Works without the dashboard.",
  },
  handler: (input, context) => {
    const date = input.date ?? context.today();
    const entries = context.read(date, {
      tool: input.tool,
      errorsOnly: input.errorsOnly,
      agentRunId: input.agentRunId,
      client: input.client,
    });
    return {
      date,
      total: entries.length,
      summary: context.summarize(date, entries),
      entries: entries.slice(-(context.limit ?? input.limit ?? 50)).reverse(),
    };
  },
});

export const mcpHistorySummaryInput = mcpHistoryInput.pick({ date: true });

export const mcpHistorySummary = defineAction<typeof mcpHistorySummaryInput, McpHistoryContext, unknown>({
  input: mcpHistorySummaryInput,
  http: { reason: "The mcp-history HTTP action includes the summary alongside its entries." },
  mcp: {
    name: "mcp_history_summary",
    toolset: "history",
    description: "Summarise a day of DevHub MCP activity: call totals, clients, busiest groups and tools, the actions taken (notes written, tasks changed, commits, agent runs dispatched…) and failures. Use for end-of-day recaps and standups. Works without the dashboard.",
  },
  handler: async (input, context) => (await mcpHistory.handler(input, context)).summary,
});
