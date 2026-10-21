import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";

export function registerBrowserTools(server: McpServer, _ctx: Context): void {
  const removed = async () => ({ content: [{ type: "text" as const, text: "DevHub in-app browser support was removed. Use your agent browser or QA tooling." }] });
  server.registerTool("browser_session", {
    description: "DevHub in-app browser support was removed. This compatibility tool returns a removal notice; use agent browser or QA tooling.",
    inputSchema: { taskId: z.string(), runId: z.string() },
  }, removed);
  const scope = { sessionId: z.string().uuid(), lease: z.string().min(43).max(43) };
  server.registerTool("browser_observe", {
    description: "DevHub in-app browser support was removed. This compatibility tool returns a removal notice; use agent browser or QA tooling.",
    inputSchema: scope,
  }, removed);
  server.registerTool("browser_request", {
    description: "DevHub in-app browser support was removed. This compatibility tool returns a removal notice; use agent browser or QA tooling.",
    inputSchema: { ...scope, action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("navigate"), url: z.string().url().max(2000) }),
      z.object({ kind: z.literal("click"), target: z.string().uuid(), observation: z.string().uuid() }),
      z.object({ kind: z.literal("type"), target: z.string().uuid(), observation: z.string().uuid(), text: z.string().min(1).max(2000) }),
    ]) },
  }, removed);
}
