import { randomUUID } from "node:crypto";
import { z } from "zod";
import { startBackgroundAgent } from "../agent-runs/background";
import { getNotesDir } from "../notes/dir";
import type { PluginContext } from "./context";
import type { LoadedRuntime, RuntimeRequest } from "./runtime-catalog";
import { runtimeResponse } from "./runtime-response";

const runIdMarker = "__DEVHUB_AGENT_RUN_ID__";
const providerMarker = "__DEVHUB_AGENT_PROVIDER__";
const atom = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
const argumentsSchema = z.record(z.string(), z.union([atom, z.array(atom).max(100)]))
  .refine(value => Object.keys(value).length <= 20 && Buffer.byteLength(JSON.stringify(value)) <= 16000);
const callSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().finite()]), method: z.literal("tools/call"),
  params: z.object({ name: z.string(), arguments: argumentsSchema.default({}) }).passthrough(),
}).passthrough();
const responseSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().finite()]),
  result: z.object({ content: z.tuple([z.object({ type: z.literal("text"), text: z.string().max(16000) }).strict()]), isError: z.literal(false).optional() }).strict(),
  hostAgentRun: z.literal(true),
}).strict();
const httpResponseSchema = z.object({ status: z.literal(200), body: z.object({ ok: z.literal(true) }).strict(), hostAgentRun: z.literal(true) }).strict();
const httpPrepareSchema = z.object({ status: z.literal(200), body: z.object({ ok: z.literal(true), prompt: z.string().max(16000), title: z.string().max(1000) }).strict(), hostAgentPrepare: z.literal(true) }).strict();

export async function applyRuntimeAgentRun(
  plugin: LoadedRuntime, ctx: PluginContext, request: RuntimeRequest, output: unknown, current: () => boolean,
  start = startBackgroundAgent, notesDir = getNotesDir,
): Promise<unknown> {
  if (!output || typeof output !== "object" || (!Object.hasOwn(output, "hostAgentRun") && !Object.hasOwn(output, "hostAgentPrepare"))) return output;
  const call = request.kind === "mcp" ? callSchema.safeParse(request.body) : null;
  const envelope = request.kind === "api" && request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : undefined;
  const rawInput = call?.success ? call.data.params.arguments : envelope?.body;
  const grant = plugin.runtime.capabilities?.agentRuns?.find(agent =>
    request.method === "POST" && ("server" in agent
      ? request.kind === "mcp" && call?.success && agent.server === request.path && agent.tool === call.data.params.name
      : request.kind === "api" && agent.path === request.path));
  const input = runtimeResponse(argumentsSchema, rawInput, plugin, ctx, "reject");
  if (!grant || Object.keys(input).some(key => !grant.inputKeys.includes(key))) throw new Error("Unreviewed agent run");
  if (Object.hasOwn(output, "hostAgentPrepare")) {
    if (request.kind !== "api" || input.prepare !== true || !current()) throw new Error("Unreviewed agent preparation");
    const prepared = runtimeResponse(httpPrepareSchema, output, plugin, ctx, "reject");
    return { status: 200, body: { ...prepared.body, cwd: notesDir() } };
  }
  const response = request.kind === "mcp" ? runtimeResponse(responseSchema, output, plugin, ctx, "reject") : undefined;
  if (!response) runtimeResponse(httpResponseSchema, output, plugin, ctx, "reject");
  const text = response?.result.content[0].text;
  if ((response && (!call?.success || response.id !== call.data.id || text!.split(runIdMarker).length !== 2 || text!.split(providerMarker).length !== 2)) || !current()) throw new Error("Invalid or stale agent run");
  const titleValue = grant.titleKey && input[grant.titleKey];
  const values = runtimeResponse(z.object({ title: z.string(), prompt: z.string() }).strict(), {
    title: typeof titleValue === "string" && titleValue.trim() ? `${grant.label}: ${titleValue.trim().slice(0, 60)}` : grant.label,
    prompt: `${grant.prompt}\n\n## Caller context\n${JSON.stringify(input, null, 2)}`,
  }, plugin, ctx, "reject");
  try {
    const started = await start({ ...values, cwd: notesDir(), requestId: randomUUID(), activity: { source: "investigation", action: grant.action }, canStart: current });
    if (response && text) return { jsonrpc: response.jsonrpc, id: response.id, result: { content: [{ type: "text", text: text.replace(runIdMarker, started.runId).replace(providerMarker, started.providerLabel) }] } };
    return { status: 200, body: { ok: true, providerLabel: started.providerLabel, runId: started.runId, ...(started.conversationId ? { conversationId: started.conversationId } : {}) } };
  } catch {
    const error = "Could not confirm whether the agent started. Check Agent Activity before retrying.";
    return response ? { jsonrpc: response.jsonrpc, id: response.id, result: { isError: true, content: [{ type: "text", text: error }] } } : { status: 502, body: { ok: false, error } };
  }
}
