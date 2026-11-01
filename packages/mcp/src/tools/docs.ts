import { z } from "zod";
import { defineAction } from "../../../../packages/shared/actions/define.ts";
import { appendContent, ContentConflictError, type ContentStorage } from "../../../../packages/shared/storage/content.ts";
import { docFilePath } from "../content-storage.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Context } from "../context.ts";
import { flattenTree } from "../shared.ts";
import { registerReleaseNotesTools } from "./release-notes.ts";
import { docsAppend, docsDelete, docsList, docsRead, docsSearch, docsWrite } from "../../../../packages/shared/actions/docs.ts";
import { registerAction } from "../actions/register.ts";

export function registerDocsTools(server: McpServer, ctx: Context): void {
  const { docsStorage, docContent, docsDir } = ctx;
  registerReleaseNotesTools(server, ctx);

  registerAction(server, docsList, docsStorage, (tree) => {
    const lines = flattenTree(tree);
    return {
      content: [
        { type: "text", text: lines.length > 0 ? `Docs in ${docsDir}:\n${lines.join("\n")}` : "No docs found" },
      ],
    };
  }, undefined, { omitInputSchema: true });

  registerAction(server, defineAction({
    ...docsRead,
    handler: async ({ path }, storage: ContentStorage) => ({ path, file: await storage.read(docFilePath(path)) }),
  }), docContent, ({ path, file }) => {
    if (!file) return { content: [{ type: "text", text: `Doc not found: ${path}\nRevision: null` }] };
    const displayPath = file.path.replace(/\.md$/i, "");
    return { content: [{ type: "text", text: `# ${displayPath}\nRevision: ${file.revision}\n\n${file.content.toString("utf8")}` }] };
  });

  registerAction(server, defineAction({
    ...docsWrite,
    input: docsWrite.input.extend({ expectedRevision: z.string().nullable().describe("Revision from docs_read; null creates only") }),
    handler: async ({ path, content, expectedRevision }, storage: ContentStorage) => ({
      path, existed: expectedRevision !== null, file: await storage.write(docFilePath(path), content, expectedRevision),
    }),
  }), docContent, ({ path, file, existed }) => ({
    content: [{ type: "text", text: `${existed ? "Updated" : "Created"}: ${path}\nRevision: ${file.revision}` }],
  }), withContentErrors);

  registerAction(server, defineAction({
    ...docsAppend,
    handler: async ({ path, content }, storage: ContentStorage) => {
      const existed = Boolean(await storage.read(docFilePath(path)));
      const file = await appendContent(storage, docFilePath(path), content);
      return { path, existed, file };
    },
  }), docContent, ({ path, existed, file }) => ({
    content: [{ type: "text", text: `${existed ? "Appended to" : "Created"}: ${path}\nRevision: ${file.revision}` }],
  }), withContentErrors);

  registerAction(server, docsSearch, docsStorage, ({ query, results }) => {
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
  });

  registerAction(server, defineAction({
    ...docsDelete,
    input: docsDelete.input.extend({ expectedRevision: z.string().describe("Revision from docs_read") }),
    handler: async ({ path, expectedRevision }, storage: ContentStorage) => ({ path, deleted: await storage.delete(docFilePath(path), expectedRevision) }),
  }), docContent, ({ path, deleted }) => ({
    content: [{ type: "text", text: `${deleted ? "Deleted" : "Not found"}: ${path}` }],
  }), withContentErrors);
}

async function withContentErrors(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ContentConflictError)) throw error;
    return { content: [{ type: "text", text: "Conflict: content changed. Read it again before writing." }], isError: true };
  }
}
