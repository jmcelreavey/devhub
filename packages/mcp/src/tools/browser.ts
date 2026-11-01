import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { browserObserve, browserRequest, browserSession } from "../../../../packages/shared/actions/browser.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";

export function registerBrowserTools(server: McpServer, _ctx: Context): void {
  const context = { removed: () => ({ content: [{ type: "text" as const, text: "DevHub in-app browser support was removed. Use your agent browser or QA tooling." }] }) };
  registerAction(server, browserSession, context, (result) => result);
  registerAction(server, browserObserve, context, (result) => result);
  registerAction(server, browserRequest, context, (result) => result);
}
