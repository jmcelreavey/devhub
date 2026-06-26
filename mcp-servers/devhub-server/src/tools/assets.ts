import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

export function registerAssetsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "assets_list",
    {
      description:
        "Inventory DevHub-managed assets via the dashboard: agents, skills, MCP servers, or persona targets (core + enabled plugins). Requires the dashboard running.",
      inputSchema: {
        kind: z.enum(["agents", "skills", "mcp", "persona"]).describe("Which asset catalog to list"),
      },
    },
    async ({ kind }) =>
      withDashboardErrors(async () => {
        if (kind === "agents") {
          const data = await dashboard.get<Array<{ name: string; description?: string | null; readOnly?: boolean }>>(
            "/api/agents",
          );
          const lines = data.map(
            (a) => `- ${a.name}${a.readOnly ? " (plugin, read-only)" : ""}${a.description ? ` — ${a.description}` : ""}`,
          );
          return { content: [{ type: "text", text: `Agents (${data.length}):\n${lines.join("\n")}` }] };
        }
        if (kind === "skills") {
          const data = await dashboard.get<{ skills?: Array<{ name: string; description?: string }> }>("/api/skills");
          const skills = data.skills ?? [];
          const lines = skills.map((s) => `- ${s.name}${s.description ? ` — ${s.description}` : ""}`);
          return { content: [{ type: "text", text: `Skills (${skills.length}):\n${lines.join("\n")}` }] };
        }
        if (kind === "mcp") {
          const data = await dashboard.get<Array<{ name: string; scope?: string; description?: string }>>("/api/mcp");
          const lines = data.map(
            (m) => `- ${m.name}${m.scope ? ` [${m.scope}]` : ""}${m.description ? ` — ${m.description}` : ""}`,
          );
          return { content: [{ type: "text", text: `MCP servers (${data.length}):\n${lines.join("\n")}` }] };
        }
        // persona
        const data = await dashboard.get<{ targets?: Array<{ id: string; label?: string }> }>("/api/persona");
        const targets = data.targets ?? [];
        const lines = targets.map((t) => `- ${t.id}${t.label ? ` — ${t.label}` : ""}`);
        return { content: [{ type: "text", text: `Persona targets (${targets.length}):\n${lines.join("\n")}` }] };
      }),
  );
}
