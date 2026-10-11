import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

const taskId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export function registerWorkflowTools(server: McpServer, ctx: Context): void {
  server.registerTool("tasks_workflow_get", {
    description: "Read durable task checks, independent reviews, approval proposals, decisions and unread events, optionally for one task. The dashboard reconciles run history and stale code evidence; it never reruns an interrupted check. Human approval decisions remain in Task workflows.",
    inputSchema: { taskId: taskId.optional() },
  }, async ({ taskId: id }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.get("/api/tasks/workflow", id ? { taskId: id } : undefined, 60_000)) }],
  })));
  server.registerTool("tasks_workflow_review", {
    description: "Record findings and verdict from a completed independent reviewer linked to this task. Requires the latest workflow revision, passing checks and an unchanged code fingerprint. Does not approve a proposal, commit, push or mark the task done. Refresh after a conflict; never invent a review.",
    inputSchema: { taskId, revision: z.number().int().nonnegative(), runId: z.string().min(1).max(100), verdict: z.enum(["pass", "changes-requested"]), findings: z.string().trim().min(1).max(20000) },
  }, async (input) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await ctx.dashboard.post("/api/tasks/workflow", { ...input, action: "review" }, 60_000)) }],
  })));
}
