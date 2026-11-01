import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { releaseNotesRead } from "../../../../packages/shared/actions/release-notes.ts";
import { registerAction } from "../actions/register.ts";
import { parseChangelog } from "../../../../packages/shared/release-notes/index.mjs";
import type { Context } from "../context.ts";

export function registerReleaseNotesTools(server: McpServer, ctx: Context): void {
  registerAction(server, releaseNotesRead, {
    read: async () => parseChangelog(await fs.readFile(path.join(ctx.repoRoot, "CHANGELOG.md"), "utf8")),
  }, (selected) => {
      return { content: [{ type: "text", text: selected.length ? selected.map((entry) => `## ${entry.version}${entry.date ? ` — ${entry.date}` : ""}\n\n${entry.markdown || "No notes for this version yet."}`).join("\n\n") : "No changelog entry found for this version." }] };
  }, async (operation) => {
    try {
      return await operation();
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: `Could not read CHANGELOG.md: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  });
}
