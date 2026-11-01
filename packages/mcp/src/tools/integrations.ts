import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { integrationsList, integrationsWrite } from "../../../../packages/shared/actions/integrations.ts";
import type { ActionResult } from "../../../../packages/shared/actions/result.ts";
import { registerAction } from "../actions/register.ts";
import { dashboardActionRequest } from "../actions/request.ts";

function actionResult(value: unknown) {
  const result = value as ActionResult<unknown>;
  return result.ok
    ? { content: [{ type: "text" as const, text: JSON.stringify(result.value) }] }
    : { content: [{ type: "text" as const, text: result.error }], isError: true };
}

export function registerIntegrationTools(server: McpServer, ctx: Context): void {
  registerAction(server, integrationsList, {
    list: (taskId) => dashboardActionRequest(() => ctx.dashboard.get("/api/integrations", taskId ? { taskId } : undefined)),
  }, actionResult);
  registerAction(server, integrationsWrite, {
    write: (input) => dashboardActionRequest(() => ctx.dashboard.post("/api/integrations/actions", input, 60_000)),
  }, actionResult);
}
