import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

export function registerSearchTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "search",
    {
      description:
        "Full search across a DevHub vault (notes or docs) via the dashboard, including trees that notes_search/docs_search scope out. Supports optional semantic mode for notes. Requires the dashboard running.",
      inputSchema: {
        query: z.string().describe("Search text"),
        vault: z.enum(["notes", "docs"]).optional().describe("Which vault to search (default: notes)"),
        prefix: z.string().optional().describe("Restrict to paths under this prefix"),
        mode: z.enum(["text", "semantic"]).optional().describe("semantic only applies to the notes vault"),
      },
    },
    async ({ query, vault, prefix, mode }) =>
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
      }),
  );
}
