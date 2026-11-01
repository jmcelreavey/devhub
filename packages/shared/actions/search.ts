import { z } from "zod";
import { defineAction } from "./define.ts";

interface SearchContext<Input> { execute: (input: Input) => unknown }

export const searchInput = z.object({
        query: z.string().describe("Search text"),
        vault: z.enum(["notes", "docs"]).optional().describe("Which vault to search (default: notes)"),
        prefix: z.string().refine((prefix) => !prefix.includes("..") && !prefix.startsWith("/"), "Invalid prefix").optional().describe("Restrict to paths under this prefix"),
        mode: z.enum(["text", "semantic"]).optional().describe("semantic only applies to the notes vault"),
      }).meta({ additionalProperties: false });
export const search = defineAction<typeof searchInput, SearchContext<z.output<typeof searchInput>>, unknown>({
  input: searchInput,
  http: {"method":"GET","path":"/api/search"},
  mcp: { name: "search", toolset: "search", description: "Full search across a DevHub vault (notes or docs) via the dashboard, including trees that notes_search/docs_search scope out. Supports optional semantic mode for notes. Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});
