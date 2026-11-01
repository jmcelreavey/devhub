import { z } from "zod";
import { createTerminalProposal } from "../terminal/proposals";
import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import type { RuntimeRequest } from "./runtime-catalog";

const proposalId = "__DEVHUB_TERMINAL_PROPOSAL_ID__";
const argumentsSchema = z.object({
  command: z.string().trim().min(1).max(8000),
  reason: z.string().max(2000).optional(),
}).strict();
const callSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().finite()]), method: z.literal("tools/call"),
  params: z.object({ name: z.string(), arguments: argumentsSchema }).passthrough(),
}).passthrough();
const responseSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().finite()]),
  result: z.object({ content: z.tuple([z.object({ type: z.literal("text"), text: z.string().max(16000) }).strict()]), isError: z.literal(false).optional() }).strict(),
  hostTerminalProposal: z.literal(true),
}).strict();

export function applyRuntimeTerminalProposal(runtime: RuntimeContribution, request: RuntimeRequest, output: unknown, current: () => boolean): unknown {
  if (!output || typeof output !== "object" || !Object.hasOwn(output, "hostTerminalProposal")) return output;
  const call = callSchema.safeParse(request.body);
  const response = responseSchema.safeParse(output);
  if (request.kind !== "mcp" || request.method !== "POST" || !call.success || !response.success || response.data.id !== call.data.id) throw new Error("Invalid terminal proposal request");
  const grant = runtime.capabilities?.terminalProposals?.find(proposal => proposal.server === request.path && proposal.tool === call.data.params.name);
  const text = response.data.result.content[0].text;
  if (!grant || text.split(proposalId).length !== 2 || !current()) throw new Error("Unreviewed or stale terminal proposal");
  const proposal = createTerminalProposal({ ...call.data.params.arguments, label: grant.label, summary: grant.summary, source: "api", autoRun: true });
  return { jsonrpc: response.data.jsonrpc, id: response.data.id, result: { ...response.data.result, content: [{ type: "text", text: text.replace(proposalId, proposal.id) }] } };
}
