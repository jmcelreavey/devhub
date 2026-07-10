import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { DashboardHttpError, withDashboardErrors } from "../dashboard-client.ts";

export function registerSessionTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "sessions_recap",
    {
      description:
        "Return an OpenCode session recap containing only sessions, commands, MCP calls, file changes, failures, and mutations. Uses an explicit session id, otherwise the current busy root, otherwise the latest root.",
      inputSchema: {
        sessionId: z.string().optional().describe("OpenCode session id; omit to select the current busy or latest root"),
        includeChildren: z.boolean().optional().describe("Include descendant sessions (default false)"),
        directory: z.string().optional().describe("Workspace directory used to scope OpenCode sessions"),
      },
    },
    async ({ sessionId, includeChildren, directory }) =>
      withDashboardErrors(async () => {
        try {
          const recap = await ctx.dashboard.get<{ sessions: unknown[] }>("/api/opencode/recap", {
            sessionId,
            children: includeChildren === true,
            directory,
          });
          return { content: [{ type: "text", text: JSON.stringify(recap, null, 2) }] };
        } catch (error) {
          if (error instanceof DashboardHttpError && (error.status === 409 || error.status === 503)) {
            const message =
              error.payload && typeof error.payload === "object" && "error" in error.payload
                ? String((error.payload as { error: unknown }).error)
                : error.status === 409
                  ? "Multiple OpenCode root sessions are busy; provide sessionId."
                  : "OpenCode is unavailable.";
            return { content: [{ type: "text", text: message }], isError: true };
          }
          throw error;
        }
      }),
  );
}
