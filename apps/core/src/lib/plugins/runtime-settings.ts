import { z } from "zod";
import { readDashboardEnvLocalFile, writeDashboardEnvLocalFile } from "../dashboard-env-local";
import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import type { RuntimeRequest } from "./runtime-catalog";
import { emitCoreEvent } from "../../domains/events/core-events";
import { runtimeEnvironmentValues } from "./runtime-environment";
import { redactRuntimeSecrets } from "./runtime-response";

const patchSchema = z.record(z.string(), z.string().trim().min(1).max(2048).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)).nullable());

function successfulResponse(output: Record<string, unknown>): boolean {
  if (!Object.hasOwn(output, "status")) return output.ok === true;
  const { status, body } = output;
  return typeof status === "number" && Number.isInteger(status) && status >= 200 && status < 300
    && status !== 204 && status !== 205 && Object.hasOwn(output, "body")
    && Object.keys(output).every(key => ["status", "body", "hostSettings"].includes(key))
    && !(body !== null && typeof body === "object" && "ok" in body && body.ok === false);
}

function successfulMcpResponse(output: Record<string, unknown>, id: string | number): boolean {
  const result = output.result;
  if (output.jsonrpc !== "2.0" || output.id !== id || !result || typeof result !== "object" || Array.isArray(result)
    || !Object.keys(output).every(key => ["jsonrpc", "id", "result", "hostSettings"].includes(key))) return false;
  const response = result as Record<string, unknown>;
  return (response.isError === undefined || response.isError === false) && Array.isArray(response.content)
    && response.content.every((entry: unknown) => !!entry && typeof entry === "object" && !Array.isArray(entry)
      && (entry as Record<string, unknown>).type === "text" && typeof (entry as Record<string, unknown>).text === "string");
}

/** The child returns a patch, never a path or the host's settings document. */
export function prepareRuntimeSettings(runtime: RuntimeContribution, request: RuntimeRequest, source: NodeJS.ProcessEnv) {
  const action = request.kind === "slot" && request.method === "POST" && request.body && typeof request.body === "object"
    ? (request.body as { action?: { path?: string; method?: string } }).action : undefined;
  const rpc = request.kind === "mcp" && request.method === "POST" && request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown> : undefined;
  const rpcId = rpc && Object.hasOwn(rpc, "id") && (typeof rpc.id === "string" || typeof rpc.id === "number" && Number.isFinite(rpc.id)) ? rpc.id : undefined;
  const params = rpc?.params && typeof rpc.params === "object" && !Array.isArray(rpc.params) ? rpc.params as Record<string, unknown> : undefined;
  const grant = runtime.capabilities?.settings?.find(setting => "server" in setting
    ? rpc?.jsonrpc === "2.0" && rpc.method === "tools/call" && rpcId !== undefined && setting.server === request.path && setting.tool === params?.name
    : "slot" in setting
      ? request.kind === "slot" && setting.slot === request.path && setting.path === action?.path && setting.method === action?.method
      : request.kind === "api" && setting.path === request.path && (setting.method ?? "POST") === request.method);
  const before = grant && source === process.env ? readDashboardEnvLocalFile(grant.keys).overrides : null;
  const initial = grant && "slot" in grant && grant.credentials ? runtimeEnvironmentValues(runtime, source) : {};
  return (output: unknown, current: () => boolean): unknown => {
    if (!output || typeof output !== "object" || !Object.hasOwn(output, "hostSettings")) return output;
    if (!grant || !before || ("server" in grant
      ? rpcId === undefined || !successfulMcpResponse(output as Record<string, unknown>, rpcId)
      : !successfulResponse(output as Record<string, unknown>))) throw new Error("Undeclared setting write");
    const { hostSettings, ...result } = output as Record<string, unknown>;
    const patch = patchSchema.parse(hostSettings);
    const entries = Object.entries(patch);
    if (!entries.length || entries.some(([key, value]) => !grant.keys.includes(key)
      || (value === null && !(("slot" in grant || "server" in grant) && grant.clear) && (key !== "AWS_PROFILE" || request.method !== "DELETE"))
      || (value !== null && !("slot" in grant) && value.length > 320)
      || (key === "AWS_PROFILE" && value !== null && (value.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9_.+?@-]*$/.test(value))))) throw new Error("Undeclared setting");
    if (!current()) throw new Error("Plugin changed during setting write");
    const saved = readDashboardEnvLocalFile(grant.keys);
    if (entries.some(([key]) => saved.overrides.get(key) !== before.get(key))) throw new Error("Setting changed during worker request");
    for (const [key, value] of entries) {
      if (value == null) saved.overrides.delete(key);
      else saved.overrides.set(key, value);
    }
    writeDashboardEnvLocalFile(saved.overrides, saved.passthrough, grant.keys);
    for (const [key, value] of entries) {
      if (value == null) delete source[key];
      else source[key] = value;
    }
    emitCoreEvent("db");
    if (!("slot" in grant) || !grant.credentials) return result;
    const secrets = runtime.permissions.env.flatMap(key => [initial[key], patch[key]].filter((value): value is string => typeof value === "string" && value.length > 0));
    return redactRuntimeSecrets(result, secrets);
  };
}
