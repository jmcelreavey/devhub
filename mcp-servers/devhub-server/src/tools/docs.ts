import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { flattenTree } from "../shared.ts";

export function registerDocsTools(server: McpServer, ctx: Context): void {
  const { docsStorage, docsDir } = ctx;

  server.registerTool(
    "docs_list",
    { description: "List all repo docs under DOCS_DIR (Markdown .md files)." },
    async () => {
      const lines = flattenTree(docsStorage.list());
      return {
        content: [
          { type: "text", text: lines.length > 0 ? `Docs in ${docsDir}:\n${lines.join("\n")}` : "No docs found" },
        ],
      };
    },
  );

  server.registerTool(
    "docs_read",
    {
      description: "Read a doc by relative path (with or without .md). Returns raw markdown.",
      inputSchema: {
        path: z.string().describe("Relative path (e.g. architecture/notes-system, SUMMARY)"),
      },
    },
    async ({ path: filePath }) => {
      const doc = docsStorage.read(filePath);
      if (!doc) {
        return { content: [{ type: "text", text: `Doc not found: ${filePath}` }] };
      }
      const displayPath = doc.path.replace(/\.md$/i, "");
      return { content: [{ type: "text", text: `# ${displayPath}\n\n${doc.content}` }] };
    },
  );

  server.registerTool(
    "docs_write",
    {
      description: "Create or update a doc. Accepts markdown text.",
      inputSchema: {
        path: z.string().describe("Relative path for the doc (e.g. guides/skills)"),
        content: z.string().describe("Markdown content to write"),
      },
    },
    async ({ path: filePath, content }) => {
      const existing = docsStorage.read(filePath);
      docsStorage.write(filePath, content);
      const action = existing ? "Updated" : "Created";
      return { content: [{ type: "text", text: `${action}: ${filePath}` }] };
    },
  );

  server.registerTool(
    "docs_append",
    {
      description: "Append markdown to an existing doc (or create it if missing).",
      inputSchema: {
        path: z.string().describe("Relative path to the doc"),
        content: z.string().describe("Markdown content to append"),
      },
    },
    async ({ path: filePath, content }) => {
      const existing = docsStorage.read(filePath);
      const combined = existing ? `${String(existing.content)}${content}` : content;
      docsStorage.write(filePath, combined);
      const action = existing ? "Appended to" : "Created";
      return { content: [{ type: "text", text: `${action}: ${filePath}` }] };
    },
  );

  server.registerTool(
    "docs_search",
    {
      description: "Search all docs under DOCS_DIR for matching text.",
      inputSchema: { query: z.string().describe("Search text") },
    },
    async ({ query }) => {
      const results = docsStorage.searchText(query);
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No results for "${query}"` }] };
      }
      const grouped: Record<string, typeof results> = {};
      for (const r of results) {
        if (!grouped[r.path]) grouped[r.path] = [];
        grouped[r.path].push(r);
      }
      const output = Object.entries(grouped)
        .map(([file, matches]) => {
          const lines = matches.map((m) => `  L${m.line}: ${m.text}`).join("\n");
          return `**${file}**\n${lines}`;
        })
        .join("\n\n");
      return {
        content: [{ type: "text", text: `Found ${results.length} match(es) for "${query}":\n\n${output}` }],
      };
    },
  );

  server.registerTool(
    "docs_delete",
    {
      description: "Delete a doc by its relative path.",
      inputSchema: { path: z.string().describe("Relative path to the doc to delete") },
    },
    async ({ path: filePath }) => {
      const deleted = docsStorage.delete(filePath);
      if (!deleted) {
        return { content: [{ type: "text", text: `Not found: ${filePath}` }] };
      }
      return { content: [{ type: "text", text: `Deleted: ${filePath}` }] };
    },
  );
}
