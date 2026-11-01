import { editorSelection, editorDiscussions, editorDiscuss, editorIncomingRead, editorSendSelection } from "../../../../packages/shared/actions/editor.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { requestAction, withDashboardErrors } from "../dashboard-client.ts";


export function registerEditorTools(server: McpServer, ctx: Context): void {
  registerAction(server, editorSelection, { execute: async ({ target }) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await requestAction(ctx.dashboard, editorIncomingRead.http, { query: target.kind === "selection" ? { id: target.id } : { workspace: target.workspace } })) }],
  })) },
    (result) => result as DashboardToolResult);
  registerAction(server, editorDiscussions, { execute: async (input) => withDashboardErrors(async () => ({
    content: [{ type: "text", text: JSON.stringify(await requestAction(ctx.dashboard, editorDiscussions.http, { body: input, timeoutMs: 60_000 })) }],
  })) },
    (result) => result as DashboardToolResult);
  registerAction(server, editorDiscuss, { refuse: () => ({ isError: true, content: [{ type: "text", text: "Review the exact selection, question and provider with the user, then pass confirm: true." }] }), execute: async ({ selection: captured, confirm: _confirm, ...send }) => {
    return withDashboardErrors(async () => ({
      content: [{ type: "text", text: JSON.stringify(await requestAction(ctx.dashboard, editorSendSelection.http, { body: { selection: captured, send }, timeoutMs: 60_000 })) }],
    }));
  } },
    (result) => result as DashboardToolResult);
}
