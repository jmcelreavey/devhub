import { z } from "zod";
import { ContentConflictError } from "../storage/content.ts";
import { defineAction } from "./define.ts";
import type { TextSearchResult, TreeEntry } from "../vault/vault-storage.ts";

export const docsListInput = z.object({});

export interface DocsTreeReader {
  list: () => TreeEntry[] | Promise<TreeEntry[]>;
}

export const docsList = defineAction<typeof docsListInput, DocsTreeReader, TreeEntry[]>({
  input: docsListInput,
  http: { method: "GET", path: "/api/docs/tree" },
  mcp: { name: "docs_list", toolset: "docs", description: "List all repo docs under DOCS_DIR (Markdown .md files)." },
  handler: (_input, context) => context.list(),
});

export const docsSearchInput = z.object({ query: z.string().describe("Search text") });

export interface DocsTextSearcher {
  searchText: (query: string) => TextSearchResult[];
}

export const docsSearch = defineAction<typeof docsSearchInput, DocsTextSearcher, { query: string; results: TextSearchResult[] }>({
  input: docsSearchInput,
  http: { reason: "The browser search ranks parsed documents and headings rather than returning matching source lines." },
  mcp: { name: "docs_search", toolset: "docs", description: "Search all docs under DOCS_DIR for matching text." },
  handler: ({ query }, context) => ({ query, results: context.searchText(query) }),
});

export const docsPageSearchInput = z.object({ query: z.string(), limit: z.number() });

export interface DocsPageSearcher {
  search: (query: string, limit: number) => unknown;
}

export const docsPageSearch = defineAction<typeof docsPageSearchInput, DocsPageSearcher, { query: string; results: unknown }>({
  input: docsPageSearchInput,
  http: { method: "GET", path: "/api/docs/search" },
  mcp: { reason: "The MCP docs_search tool returns source-line matches rather than ranked page search results." },
  handler: ({ query, limit }, context) => ({ query, results: query.length < 2 ? [] : context.search(query, limit) }),
});

export const docsAssetReadInput = z.object({ path: z.string(), range: z.string().nullable() });

export interface DocsAssetReader {
  serve: (path: string, range: string | null) => unknown;
}

export const docsAssetRead = defineAction<typeof docsAssetReadInput, DocsAssetReader, unknown>({
  input: docsAssetReadInput,
  http: { method: "GET", path: "/api/docs-assets/[...path]" },
  mcp: { reason: "The browser requests binary doc assets and byte ranges; MCP has no binary doc asset reader." },
  handler: ({ path, range }, context) => context.serve(path, range),
});

export interface DocFile {
  path: string;
  content: unknown;
  modified: number;
  size: number;
  revision?: string;
}

export interface DocsReader {
  read: (path: string) => DocFile | null;
}

export interface DocsReadResult {
  path: string;
  file: DocFile | null;
}

export interface DocsWriter extends DocsReader {
  write: (path: string, content: string, expectedRevision: string | null) => DocFile | Promise<DocFile>;
  delete: (path: string, expectedRevision: string) => boolean | Promise<boolean>;
}

export interface DocsWriteResult {
  path: string;
  existed: boolean;
  file: DocFile | null;
}

export interface DocsDeleteResult {
  path: string;
  deleted: boolean;
}

const docsReadInput = z.object({
  path: z.string().describe("Relative path (e.g. architecture/notes-system, SUMMARY)"),
}).meta({ additionalProperties: false });

export const docsRead = defineAction<typeof docsReadInput, DocsReader, DocsReadResult>({
  input: docsReadInput,
  http: { method: "GET", path: "/api/docs/[...path]" },
  mcp: { name: "docs_read", toolset: "docs", description: "Read a doc by relative path (with or without .md). Returns raw markdown." },
  handler: ({ path }, storage) => ({ path, file: storage.read(path) }),
});

const docsWriteInput = z.object({
  path: z.string().describe("Relative path for the doc (e.g. guides/skills)"),
  content: z.string().describe("Markdown content to write"),
  expectedRevision: z.string().nullable().optional(),
}).meta({ additionalProperties: false });

async function writeDoc(input: z.output<typeof docsWriteInput>, storage: DocsWriter, createOnly: boolean): Promise<DocsWriteResult> {
  const existing = storage.read(input.path);
  if (existing && createOnly) return { path: input.path, existed: true, file: null };
  return { path: input.path, existed: Boolean(existing), file: await storage.write(input.path, input.content, createOnly ? null : input.expectedRevision ?? null) };
}

export const docsWrite = defineAction<typeof docsWriteInput, DocsWriter, DocsWriteResult>({
  input: docsWriteInput,
  http: { method: "PUT", path: "/api/docs/[...path]" },
  mcp: { name: "docs_write", toolset: "docs", description: "Create or update a doc. Accepts markdown text." },
  handler: (input, storage) => writeDoc(input, storage, false),
});

export const docsCreate = defineAction<typeof docsWriteInput, DocsWriter, DocsWriteResult>({
  input: docsWriteInput,
  http: { method: "POST", path: "/api/docs/[...path]" },
  mcp: { reason: "The MCP docs_write tool already supports creation." },
  handler: (input, storage) => writeDoc(input, storage, true),
});

const docsAppendInput = z.object({
  path: z.string().describe("Relative path to the doc"),
  content: z.string().describe("Markdown content to append"),
}).meta({ additionalProperties: false });

export const docsAppend = defineAction<typeof docsAppendInput, DocsWriter, DocsWriteResult>({
  input: docsAppendInput,
  http: { reason: "Appending is an MCP-only operation." },
  mcp: { name: "docs_append", toolset: "docs", description: "Append markdown to an existing doc (or create it if missing)." },
  handler: async ({ path, content }, storage) => {
    for (let attempt = 0; ; attempt++) {
      const existing = storage.read(path);
      const combined = existing ? `${String(existing.content)}${content}` : content;
      try {
        return { path, existed: Boolean(existing), file: await storage.write(path, combined, existing?.revision ?? null) };
      } catch (error) {
        if (!(error instanceof ContentConflictError) || attempt !== 0) throw error;
      }
    }
  },
});

const docsDeleteInput = z.object({
  path: z.string().describe("Relative path to the doc to delete"),
  expectedRevision: z.string().optional(),
}).meta({ additionalProperties: false });

export const docsDelete = defineAction<typeof docsDeleteInput, DocsWriter, DocsDeleteResult>({
  input: docsDeleteInput,
  http: { method: "DELETE", path: "/api/docs/[...path]" },
  mcp: { name: "docs_delete", toolset: "docs", description: "Delete a doc by its relative path." },
  handler: async ({ path, expectedRevision }, storage) => {
    const current = storage.read(path);
    if (!current && expectedRevision !== undefined) throw new ContentConflictError(path);
    return { path, deleted: current ? await storage.delete(path, expectedRevision ?? current.revision!) : false };
  },
});
