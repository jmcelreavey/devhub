import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { ActionDefinition } from "../../../../packages/shared/actions/define.ts";

export function registerAction<Schema extends z.ZodObject, Context, Result>(
  server: McpServer,
  action: ActionDefinition<Schema, Context, Result>,
  context: Context,
  response: (result: Result) => CallToolResult | Promise<CallToolResult>,
  execute: (operation: () => Promise<CallToolResult>) => Promise<CallToolResult> = (operation) => operation(),
  options: {
    omitInputSchema?: boolean;
    contextForRequest?: (context: Context, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => Context;
  } = {},
): void {
  if (!("name" in action.mcp)) throw new Error(`MCP action unavailable: ${action.mcp.reason}`);
  const inputSchema: z.ZodObject = action.input;
  server.registerTool(action.mcp.name, {
    description: action.mcp.description,
    ...(options.omitInputSchema ? {} : { inputSchema }),
    annotations: action.mcp.annotations,
  }, async (input, extra) => execute(async () => response(await action.handler(
    input as z.output<Schema>,
    options.contextForRequest?.(context, extra) ?? context,
  ))));
}
