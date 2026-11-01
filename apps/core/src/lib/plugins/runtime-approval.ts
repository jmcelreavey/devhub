import { z } from "zod";
import type { HostApprovalRequest, PluginJson } from "../../../../../packages/shared/plugin-runtime";
import { createTerminalProposal, takeHostApproval } from "../terminal/proposals";
import type { PluginContext } from "./context";
import type { LoadedRuntime, RuntimeRequest } from "./runtime-catalog";
import { runtimeResponse } from "./runtime-response";

const marker = "__DEVHUB_APPROVAL_ID__";
const approvalSchema = z.object({
  id: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(500),
  payload: z.unknown(),
}).strict().refine(value => Object.hasOwn(value, "payload") && Buffer.byteLength(JSON.stringify(value.payload) ?? "") <= 16384);
const rpcSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().finite()]),
  result: z.object({ content: z.tuple([z.object({ type: z.literal("text"), text: z.string().max(16000) }).strict()]), isError: z.literal(false).optional() }).strict(),
  hostApproval: approvalSchema,
}).strict();

function target(plugin: LoadedRuntime, request: RuntimeRequest): string | null {
  if (request.kind === "api") {
    return plugin.runtime.capabilities?.approvals?.some(grant => "path" in grant && grant.path === request.path && grant.method === request.method)
      ? `api:${request.method}:${request.path}` : null;
  }
  if (request.kind !== "mcp" || request.method !== "POST" || !request.body || typeof request.body !== "object") return null;
  const call = request.body as { method?: unknown; params?: { name?: unknown } };
  if (call.method !== "tools/call" || typeof call.params?.name !== "string") return null;
  return plugin.runtime.capabilities?.approvals?.some(grant => "server" in grant && grant.server === request.path && grant.tool === call.params?.name)
    ? `mcp:${request.path}:${call.params.name}` : null;
}

/** The caller supplies only the opaque id. The host supplies the decision and original payload. */
export function runtimeApprovalDecision(plugin: LoadedRuntime, request: RuntimeRequest) {
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : undefined;
  const params = request.kind === "mcp" ? body?.params as { arguments?: Record<string, unknown> } | undefined : undefined;
  const id = request.kind === "mcp" ? params?.arguments?.hostApprovalId : body?.hostApprovalId;
  if (id === undefined) return undefined;
  const entry = target(plugin, request);
  if (!entry) return undefined;
  if (typeof id !== "string") throw new Error("Invalid approval reference");
  return takeHostApproval(id, plugin.id, plugin.revision, entry);
}

export function applyRuntimeApproval(plugin: LoadedRuntime, ctx: PluginContext, request: RuntimeRequest, output: unknown, current: () => boolean): unknown {
  if (!output || typeof output !== "object" || !Object.hasOwn(output, "hostApproval")) return output;
  const entry = target(plugin, request);
  if (!entry || !current()) throw new Error("Unreviewed or stale approval request");
  const raw = output as Record<string, unknown>;
  let approval: HostApprovalRequest;
  let rpc: z.infer<typeof rpcSchema> | undefined;
  if (request.kind === "mcp") {
    rpc = runtimeResponse(rpcSchema, output, plugin, ctx, "reject");
    const call = request.body as { id?: unknown };
    if (rpc.id !== call.id || rpc.result.content[0].text.split(marker).length !== 2) throw new Error("Invalid approval response");
    approval = rpc.hostApproval as HostApprovalRequest;
  } else {
    if (raw.ok === false) throw new Error("Failed request cannot ask for approval");
    if (Object.hasOwn(raw, "status")) {
      if (typeof raw.status !== "number" || !Number.isInteger(raw.status) || raw.status < 200 || raw.status >= 300 || raw.status === 204 || raw.status === 205 || !raw.body || typeof raw.body !== "object" || Array.isArray(raw.body) || Object.hasOwn(raw.body, "hostApproval") || (raw.body as Record<string, unknown>).ok === false) throw new Error("Invalid alias approval response");
    }
    approval = runtimeResponse(approvalSchema, raw.hostApproval, plugin, ctx, "reject") as { id: string; summary: string; payload: PluginJson };
  }
  const proposal = createTerminalProposal({
    command: "Plugin approval", label: plugin.name, summary: approval.summary, source: "api", requiresConfirmation: true,
    hostApproval: { ...approval, plugin: plugin.id, revision: plugin.revision, target: entry },
  });
  if (rpc) return { jsonrpc: rpc.jsonrpc, id: rpc.id, result: { ...rpc.result, content: [{ type: "text", text: rpc.result.content[0].text.replace(marker, proposal.id) }] } };
  return { ...raw, hostApproval: { proposalId: proposal.id, status: "pending" } };
}
