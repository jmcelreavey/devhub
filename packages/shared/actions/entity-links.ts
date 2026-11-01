import { z } from "zod";
import { defineAction } from "./define.ts";

interface NotesActionContext<Input> { execute: (input: Input) => unknown }

export const entityLinksReadInput = z.object({
        path: z.string().describe("Note path relative to notes/"),
}).meta({ additionalProperties: false });
export const entityLinksRead = defineAction<typeof entityLinksReadInput, NotesActionContext<z.output<typeof entityLinksReadInput>>, unknown>({
  input: entityLinksReadInput,
  http: { reason: "The HTTP entity graph resolves relationships; it does not return the raw links section of a note." },
  mcp: { name: "entity_links_read", toolset: "notes", description: "Read EntityRefs from a note's ## Links section (same parse as the UI relations panel)." },
  handler: (input, context) => context.execute(input),
});

export const entityLinksResolveInput = z.object({
        kind: z
          .enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"])
          .describe("Entity kind"),
        id: z
          .string()
          .describe("Task uuid, Jira key, owner/repo#n, note path, or repo name"),
        date: z.string().optional().describe("YYYY-MM-DD — narrows a task lookup"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe("1 (default) = direct links only; 2 also expands them one hop"),
}).meta({ additionalProperties: false });
export const entityLinksResolve = defineAction<typeof entityLinksResolveInput, NotesActionContext<z.output<typeof entityLinksResolveInput>>, unknown>({
  input: entityLinksResolveInput,
  http: { method: "GET", path: "/api/entity-links" },
  mcp: { name: "entity_links_resolve", toolset: "notes", description: "Everything linked to a task, ticket, PR, note or repo — in both directions. Links are stored one-way, so this is the only way to see what points AT something. Call it before starting work: related tickets and their plan notes usually carry context the item's own text doesn't. depth 2 also returns what those links link to." },
  handler: (input, context) => context.execute(input),
});
