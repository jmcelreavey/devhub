import { z } from "zod";
import { defineAction } from "./define.ts";

type AuditResult = { content: { type: "text"; text: string }[]; isError?: boolean };
interface AuditContext<Input> { execute: (input: Input) => AuditResult | Promise<AuditResult> }
const http = { reason: "DX audit reports are read directly from the notes store by MCP clients; no dashboard endpoint exists." };

export const dxAuditListInput = z.object({ repo: z.string().optional().describe("Repo name to filter by (e.g. 'example-app')") }).meta({ additionalProperties: false });
export const dxAuditList = defineAction<typeof dxAuditListInput, AuditContext<z.output<typeof dxAuditListInput>>, AuditResult>({
  input: dxAuditListInput, http,
  mcp: { name: "dx_audit_list", toolset: "dx-audit", description: "List developer-experience audit reports written by the dx-audit skill (notes under reviews/dx-audit-<repo>-<date>). Optionally filter by repo name. Newest first." },
  handler: (input, context) => context.execute(input),
});

export const dxAuditReadInput = z.object({
  repo: z.string().describe("Repo name (e.g. 'example-app')"),
  date: z.string().optional().describe("Specific audit date YYYY-MM-DD; defaults to latest"),
}).meta({ additionalProperties: false });
export const dxAuditRead = defineAction<typeof dxAuditReadInput, AuditContext<z.output<typeof dxAuditReadInput>>, AuditResult>({
  input: dxAuditReadInput, http,
  mcp: { name: "dx_audit_read", toolset: "dx-audit", description: "Read a DX audit report as markdown. Give a repo name to get its latest audit, or a repo plus date (YYYY-MM-DD) for a specific one." },
  handler: (input, context) => context.execute(input),
});
