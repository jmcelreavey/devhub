import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sessionRecap } from "../../../../packages/shared/actions/sessions.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { DashboardHttpError, withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";

export function registerSessionTools(server: McpServer, ctx: Context): void {
  registerAction(
    server, sessionRecap,
    { recap: async ({ sessionId, includeChildren, directory }) => ({
      status: 200,
      body: await ctx.dashboard.get<{ sessions: unknown[] }>("/api/opencode/recap", {
        sessionId,
        children: includeChildren === true,
        directory,
      }),
    }) },
    ({ body }) => ({ content: [{ type: "text", text: JSON.stringify(body) }] }),
    (operation) => withDashboardErrors(async () => {
        try {
          return await operation() as DashboardToolResult;
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
