import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
export function registerTeamTaskTools(server: McpServer, ctx: Context): void {
  const taskId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
  const teammate = z.string().trim().min(1).max(200);
  server.registerTool("task_ask_teammate", {
    description: "Ask a linked teammate about a task's open question in team Slack. Without a channel, opens a group DM. A reply is only a suggestion until the owner sends it as an answer.",
    inputSchema: { taskId, teammate: teammate.describe("Slack user ID or linked teammate name"), channel: z.string().regex(/^[CG][A-Z0-9]+$/).optional() },
  }, async (input) => withDashboardErrors(async () => {
    const result = await ctx.dashboard.post("/api/team/collaboration", { action: "ask", ...input });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }));
  server.registerTool("task_handoff", {
    description: "Prepare a task handoff to a linked teammate and send the owner a red confirmation in team Slack. Nothing is stopped, committed or pushed until the owner clicks Push and hand off or Commit WIP and push. Pending and accepted handoffs are read-only.",
    inputSchema: { taskId, teammate, reassignJira: z.boolean().optional(), commitWip: z.boolean().optional() },
  }, async (input) => withDashboardErrors(async () => {
    const result = await ctx.dashboard.post("/api/team/collaboration", { action: "handoff", ...input, postConfirmation: true });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }));
}

