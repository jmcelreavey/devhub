import { search } from "../../../../packages/shared/actions/search.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

export function registerSearchTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(server, search, { execute: async ({ query, vault, prefix, mode }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          total?: number;
          files?: Array<{ path: string; score?: number; matches?: Array<{ line: number; text: string }> }>;
        }>("/api/search", { q: query, vault, prefix, mode });
        const files = data.files ?? [];
        if (files.length === 0) {
          return { content: [{ type: "text", text: `No results for "${query}".` }] };
        }
        const out = files
          .map((f) => {
            const matches = (f.matches ?? []).map((m) => `  L${m.line}: ${m.text}`).join("\n");
            const score = typeof f.score === "number" ? ` (score ${f.score.toFixed(2)})` : "";
            return `**${f.path}**${score}${matches ? `\n${matches}` : ""}`;
          })
          .join("\n\n");
        return { content: [{ type: "text", text: `Found ${data.total ?? files.length} result(s) for "${query}":\n\n${out}` }] };
      }) },
    (result) => result as DashboardToolResult);
}
