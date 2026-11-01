import { z } from "zod";
import { defineAction } from "./define.ts";
import { normaliseReleaseVersion, RELEASE_VERSION_PATTERN, type ReleaseEntry } from "../release-notes/index.mjs";

const releaseVersion = z.string().trim().regex(RELEASE_VERSION_PATTERN);

export const releaseNotesReadInput = z.object({
  version: releaseVersion.max(100).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  includeUnreleased: z.boolean().optional(),
}).meta({ additionalProperties: false });

export interface ReleaseNotesContext {
  read: () => ReleaseEntry[] | Promise<ReleaseEntry[]>;
  // The dashboard shows the complete changelog; MCP defaults to ten shipped releases.
  all?: boolean;
}

export const releaseNotesRead = defineAction<typeof releaseNotesReadInput, ReleaseNotesContext, ReleaseEntry[]>({
  input: releaseNotesReadInput,
  http: { reason: "The headless MCP view is bounded and omits Unreleased by default; the dashboard serves the complete bundled history." },
  mcp: {
    name: "release_notes_read", toolset: "docs",
    description: "Read CHANGELOG.md from this DevHub checkout without needing the dashboard. Select a version (with or without v), or list recent releases. Unreleased changes are opt-in and never presented as shipped.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  handler: async ({ version, limit = 10, includeUnreleased = false }, context) => {
    const releases = await context.read();
    if (version) return releases.filter((entry) => entry.version === normaliseReleaseVersion(version));
    if (context.all) return releases;
    return releases.filter((entry) => includeUnreleased || entry.version !== "Unreleased").slice(0, limit);
  },
});

export const releaseNotesHistoryInput = z.object({ version: releaseVersion.optional() });
export const releaseNotesHistory = defineAction<typeof releaseNotesHistoryInput, ReleaseNotesContext, ReleaseEntry[]>({
  input: releaseNotesHistoryInput,
  http: { method: "GET", path: "/api/release-notes" },
  mcp: { reason: "The dashboard serves the complete bundled history, including Unreleased; release_notes_read is the bounded headless view." },
  handler: (input, context) => releaseNotesRead.handler(input, { ...context, all: true }),
});
