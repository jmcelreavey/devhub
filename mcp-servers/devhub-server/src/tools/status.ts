import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

export function registerStatusTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "status_services",
    {
      description:
        "Local dev service status (OpenChamber, OpenCode, etc.) from the DevHub dashboard. Shows whether each peer service is active. Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<Record<string, { active: boolean; uptime: string | null }>>(
          "/api/status/services",
        );
        const entries = Object.entries(data);
        if (entries.length === 0) {
          return { content: [{ type: "text", text: "No dev services reported." }] };
        }
        const lines = entries.map(
          ([id, s]) => `- ${id}: ${s.active ? "active" : "inactive"}${s.uptime ? ` (up ${s.uptime})` : ""}`,
        );
        return { content: [{ type: "text", text: `Dev services:\n${lines.join("\n")}` }] };
      }),
  );

  server.registerTool(
    "status_git",
    {
      description:
        "Git status of the DevHub repo: dirty/syncable content (notes, tasks, docs), unpushed commits, and merge conflicts. Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<unknown>("/api/status/git");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }),
  );

  server.registerTool(
    "status_mcp",
    {
      description:
        "Runtime status of the configured MCP servers: which are running, PIDs, and whether their binary exists. Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<
          Array<{ name: string; runningCount: number; pids: number[]; binaryExists: boolean }>
        >("/api/status/mcp");
        if (!Array.isArray(data) || data.length === 0) {
          return { content: [{ type: "text", text: "No MCP servers reported." }] };
        }
        const lines = data.map((m) => {
          const run = m.runningCount > 0 ? `running ×${m.runningCount} (pids ${m.pids.join(", ")})` : "not running";
          const bin = m.binaryExists ? "" : " · binary missing";
          return `- ${m.name}: ${run}${bin}`;
        });
        return { content: [{ type: "text", text: `MCP servers:\n${lines.join("\n")}` }] };
      }),
  );

  server.registerTool(
    "services_restart",
    {
      description:
        "Restart a local dev peer service (openchamber or opencode). Mutates running processes — requires confirm:true. Requires the dashboard running.",
      inputSchema: {
        service: z.enum(["openchamber", "opencode"]).describe("Which dev service to restart"),
        confirm: z.boolean().optional().describe("Required (true) to actually restart"),
      },
    },
    async ({ service, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return {
            content: [{ type: "text", text: `Restarting ${service} interrupts it. Re-run with confirm: true.` }],
            isError: true,
          };
        }
        await dashboard.post<{ ok: boolean; restarted: boolean }>("/api/status/services/restart", { service });
        return { content: [{ type: "text", text: `Restarted ${service}.` }] };
      }),
  );
}
