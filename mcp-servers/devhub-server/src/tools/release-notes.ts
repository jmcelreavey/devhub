import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normaliseReleaseVersion, parseChangelog, RELEASE_VERSION_PATTERN } from "../../../../shared/release-notes/index.mjs";
import type { Context } from "../context.ts";

export function registerReleaseNotesTools(server: McpServer, ctx: Context): void {
  server.registerTool("release_notes_read", {
    description: "Read CHANGELOG.md from this DevHub checkout without needing the dashboard. Select a version (with or without v), or list recent releases. Unreleased changes are opt-in and never presented as shipped.",
    inputSchema: {
      version: z.string().trim().max(100).regex(RELEASE_VERSION_PATTERN).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      includeUnreleased: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ version, limit = 10, includeUnreleased = false }) => {
    try {
      const releases = parseChangelog(await fs.readFile(path.join(ctx.repoRoot, "CHANGELOG.md"), "utf8"));
      const selected = version ? releases.filter((entry) => entry.version === normaliseReleaseVersion(version)) : releases.filter((entry) => includeUnreleased || entry.version !== "Unreleased").slice(0, limit);
      return { content: [{ type: "text", text: selected.length ? selected.map((entry) => `## ${entry.version}${entry.date ? ` — ${entry.date}` : ""}\n\n${entry.markdown || "No notes for this version yet."}`).join("\n\n") : "No changelog entry found for this version." }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: `Could not read CHANGELOG.md: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  });
}
