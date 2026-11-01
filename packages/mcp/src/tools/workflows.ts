import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import { taskWorkflowGet, taskWorkflowReview, type WorkflowOutcome } from "../../../../packages/shared/actions/workflows.ts";
import { registerAction } from "../actions/register.ts";

async function dashboardOutcome(work: () => Promise<unknown>): Promise<WorkflowOutcome> {
  try {
    return { ok: true, value: await work(), status: 200 };
  } catch (error) {
    const result = await withDashboardErrors(async () => { throw error; });
    const message = result.content.find((item) => item.type === "text");
    return { ok: false, error: message?.type === "text" ? message.text : "Unexpected error", status: 0 };
  }
}

function workflowResponse(result: WorkflowOutcome) {
  return result.ok
    ? { content: [{ type: "text" as const, text: JSON.stringify(result.value) }] }
    : { content: [{ type: "text" as const, text: result.error }], isError: true };
}

export function registerWorkflowTools(server: McpServer, ctx: Context): void {
  registerAction(server, taskWorkflowGet, {
    read: (id) => dashboardOutcome(() => ctx.dashboard.get("/api/tasks/workflow", id ? { taskId: id } : undefined, 60_000)),
  }, workflowResponse);
  registerAction(server, taskWorkflowReview, {
    execute: (input) => dashboardOutcome(() => ctx.dashboard.post("/api/tasks/workflow", input, 60_000)),
  }, workflowResponse);
}
