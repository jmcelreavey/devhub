import { z } from "zod";
import { defineAction } from "./define.ts";

interface AssetsContext<Input> { execute: (input: Input) => unknown }

export const assetsListInput = z.object({
        kind: z.enum(["agents", "skills", "mcp", "persona"]).describe("Which asset catalog to list"),
      }).meta({ additionalProperties: false });
export const assetsList = defineAction<typeof assetsListInput, AssetsContext<z.output<typeof assetsListInput>>, unknown>({
  input: assetsListInput,
  http: {"reason":"MCP catalog selector composes the existing agents, skills, MCP and persona routes; no aggregate HTTP route is added."},
  mcp: { name: "assets_list", toolset: "assets", description: "Inventory DevHub-managed assets via the dashboard: agents, skills, MCP servers, or persona targets (core + enabled plugins). Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const mcpCatalogListInput = z.object({});
export const mcpCatalogList = defineAction<typeof mcpCatalogListInput, AssetsContext<z.output<typeof mcpCatalogListInput>>, unknown>({
  input: mcpCatalogListInput,
  http: { method: "GET", path: "/api/mcp" },
  mcp: { reason: "assets_list selects this existing catalog; MCP does not get catalog editing authority." },
  handler: (input, context) => context.execute(input),
});

export const mcpCatalogCreateInput = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/i), command: z.string(), description: z.string().optional(), scope: z.enum(["repo", "personal"]) });
export const mcpCatalogCreate = defineAction<typeof mcpCatalogCreateInput, AssetsContext<z.output<typeof mcpCatalogCreateInput>>, unknown>({
  input: mcpCatalogCreateInput,
  http: { method: "POST", path: "/api/mcp" },
  mcp: { reason: "Creating host MCP configuration is a local dashboard editing workflow." },
  handler: (input, context) => context.execute(input),
});

export const mcpCatalogReadInput = z.object({ name: z.string(), scope: z.enum(["repo", "personal"]) });
export const mcpCatalogRead = defineAction<typeof mcpCatalogReadInput, AssetsContext<z.output<typeof mcpCatalogReadInput>>, unknown>({
  input: mcpCatalogReadInput,
  http: { method: "GET", path: "/api/mcp/[name]" },
  mcp: { reason: "Reading raw host MCP configuration is a local editor view; assets_list returns only catalog metadata." },
  handler: (input, context) => context.execute(input),
});

export const mcpCatalogSaveInput = mcpCatalogReadInput.extend({ content: z.string().refine((content) => Boolean(content.trim())) });
export const mcpCatalogSave = defineAction<typeof mcpCatalogSaveInput, AssetsContext<z.output<typeof mcpCatalogSaveInput>>, unknown>({
  input: mcpCatalogSaveInput,
  http: { method: "PUT", path: "/api/mcp/[name]" },
  mcp: { reason: "Saving host MCP configuration remains a local dashboard editing workflow." },
  handler: (input, context) => context.execute(input),
});

export const mcpCatalogRenameInput = mcpCatalogReadInput.extend({ newName: mcpCatalogCreateInput.shape.name });
export const mcpCatalogRename = defineAction<typeof mcpCatalogRenameInput, AssetsContext<z.output<typeof mcpCatalogRenameInput>>, unknown>({
  input: mcpCatalogRenameInput,
  http: { method: "PATCH", path: "/api/mcp/[name]" },
  mcp: { reason: "Renaming host MCP configuration remains a local dashboard editing workflow." },
  handler: (input, context) => context.execute(input),
});

export const mcpCatalogDeleteInput = mcpCatalogReadInput;
export const mcpCatalogDelete = defineAction<typeof mcpCatalogDeleteInput, AssetsContext<z.output<typeof mcpCatalogDeleteInput>>, unknown>({
  input: mcpCatalogDeleteInput,
  http: { method: "DELETE", path: "/api/mcp/[name]" },
  mcp: { reason: "Removing host MCP configuration remains a local dashboard editing workflow." },
  handler: (input, context) => context.execute(input),
});

export const mcpLocalCandidatesInput = z.object({});
export const mcpLocalCandidates = defineAction<typeof mcpLocalCandidatesInput, AssetsContext<z.output<typeof mcpLocalCandidatesInput>>, unknown>({
  input: mcpLocalCandidatesInput,
  http: { method: "GET", path: "/api/mcp/local" },
  mcp: { reason: "Installed MCP configuration discovery is a local import picker." },
  handler: (input, context) => context.execute(input),
});
