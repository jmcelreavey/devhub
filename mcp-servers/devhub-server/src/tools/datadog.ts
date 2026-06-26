import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

export function registerDatadogTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "datadog_oncall",
    {
      description:
        "Who is currently on call (Datadog On-Call), and whether that's you. Requires the dashboard running and Datadog configured in /setup.",
    },
    async () =>
      withDashboardErrors(async () => {
        const d = await dashboard.get<
          | { ok: true; onCall: boolean; users: Array<{ email: string; name?: string }>; checkedAt: string }
          | { ok: false; code: string; message?: string }
        >("/api/datadog/oncall");
        if (!d.ok) {
          return { content: [{ type: "text", text: `Datadog on-call unavailable (${d.code}).` }], isError: true };
        }
        const roster = d.users.map((u) => `  - ${u.name ?? u.email} <${u.email}>`).join("\n") || "  (none)";
        return {
          content: [
            { type: "text", text: `${d.onCall ? "You ARE on call." : "You are not on call."}\nOn call now:\n${roster}` },
          ],
        };
      }),
  );

  server.registerTool(
    "datadog_recent_alerts",
    {
      description:
        "Recent Datadog alerts / on-call context (site, on-call, team Slack). Requires the dashboard running and Datadog configured.",
    },
    async () =>
      withDashboardErrors(async () => {
        const d = await dashboard.get<Record<string, unknown>>("/api/datadog/recent-alerts");
        if (d.ok === false) {
          return { content: [{ type: "text", text: `Datadog alerts unavailable: ${JSON.stringify(d)}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(d, null, 2) }] };
      }),
  );

  server.registerTool(
    "datadog_investigate",
    {
      description:
        "Kick off an OpenCode investigation session for a Datadog alert/incident. Returns a session id. Requires the dashboard running, Datadog + OpenCode configured.",
      inputSchema: {
        title: z.string().optional().describe("Short incident/alert title"),
        scope: z.enum(["general", "oncall", "team"]).optional().describe("Investigation scope (default general)"),
        status: z.string().optional().describe("Alert status, if known"),
        tags: z.array(z.string()).optional().describe("Datadog tags to scope the investigation"),
      },
    },
    async ({ title, scope, status, tags }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ ok: boolean; sessionId?: string; error?: string }>(
          "/api/datadog/investigate",
          { title, scope, status, tags },
          60_000,
        );
        if (!r.ok || !r.sessionId) {
          return { content: [{ type: "text", text: `Could not start investigation: ${r.error ?? "unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Started investigation — OpenCode session ${r.sessionId}.` }] };
      }),
  );
}
