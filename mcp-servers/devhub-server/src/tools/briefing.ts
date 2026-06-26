import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

export function registerBriefingTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "briefing_get",
    {
      description:
        "Get today's morning briefing (calendar, news, weather, dev tip, etc.) as readable text. Cached per day by the dashboard. Requires the dashboard running. First call of the day may take a few seconds.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ ok?: boolean; text?: string; generatedAt?: string; cached?: boolean }>(
          "/api/dashboard/morning-briefing",
          undefined,
          60_000,
        );
        const text = data.text?.trim();
        if (!text) {
          return { content: [{ type: "text", text: "Briefing returned no text." }], isError: true };
        }
        const meta = data.generatedAt ? `\n\n_(generated ${data.generatedAt}${data.cached ? ", cached" : ""})_` : "";
        return { content: [{ type: "text", text: `${text}${meta}` }] };
      }),
  );
}
