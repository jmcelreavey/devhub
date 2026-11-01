import { loadRuntime, type LoadedRuntime, type RuntimeRequest } from "./runtime-catalog";
export { loadRuntime, runtimeCatalog, type LoadedRuntime, type RuntimeRequest } from "./runtime-catalog";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { z } from "zod";
import { execExternal } from "../exec-external";
import { PluginApiError, type PluginContext } from "./context";
import { assertSafePath } from "./filesystem";
import { runtimeEnvironmentValues } from "./runtime-environment";
import { expandHome } from "./registry";
import { readReceipt } from "./store";
import { runtimeApproval } from "./install";
import { findEntry } from "./views";
import { runtimeFile } from "./runtime-files";
import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { runtimeNoteScopes } from "./runtime-notes";
import { runtimeStateScopes } from "./runtime-state";
import { prepareRuntimeReads, type RuntimeProviderLookup } from "./runtime-reads";
import { prepareRuntimeSettings } from "./runtime-settings";
import { applyRuntimeTerminalProposal } from "./runtime-terminal";
import { applyRuntimeAgentRun } from "./runtime-agent";
import type { HostApprovalDecision, PluginStreamEvent } from "../../../../../packages/shared/plugin-runtime";
import { applyRuntimeApproval, runtimeApprovalDecision } from "./runtime-approval";
import { startRuntimeDataSync } from "./runtime-data-sync";
import { runtimeResponse } from "./runtime-response";

export type RuntimeEvent = PluginStreamEvent;
/** Version-one streaming routes use newline-delimited output events and one final result. */
export class RuntimeStream {
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private result: unknown;
  private complete = false;
  constructor(private emit?: (event: RuntimeEvent) => void) {}
  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    if (Buffer.byteLength(this.pending) > 256 * 1024) throw new Error("Stream record too large");
    let end: number;
    while ((end = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      if (!line) continue;
      const event: unknown = JSON.parse(line);
      if (!event || typeof event !== "object" || this.complete) throw new Error("Invalid stream");
      const record = event as Record<string, unknown>;
      if (record.type === "output" && typeof record.text === "string" && record.text.length <= 16384) this.emit?.({ type: "output", text: record.text });
      else if (record.type === "progress" && typeof record.text === "string" && record.text.length <= 16384 &&
        (record.current === undefined || typeof record.current === "number" && Number.isFinite(record.current) && record.current >= 0) &&
        (record.total === undefined || typeof record.total === "number" && Number.isFinite(record.total) && record.total > 0) &&
        (typeof record.current !== "number" || typeof record.total !== "number" || record.current <= record.total)) {
        this.emit?.({ type: "progress", text: record.text, ...(typeof record.current === "number" ? { current: record.current } : {}), ...(typeof record.total === "number" ? { total: record.total } : {}) });
      }
      else if (record.type === "result" && Object.hasOwn(record, "result")) { this.result = record.result; this.complete = true; }
      else throw new Error("Invalid stream record");
    }
  }
  finish(): unknown {
    this.pending += this.decoder.end();
    if (this.pending.trim() || !this.complete) throw new Error("Incomplete stream");
    return this.result;
  }
}

/** The service and request workers share the same filesystem and environment boundary. */
export function runtimeWorkerOptions(ctx: PluginContext, plugin: LoadedRuntime) {
  const data = path.join(ctx.paths.pluginHome, "runtime-data", plugin.id);
  assertSafePath(ctx.paths.pluginHome, data);
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  const args = ["--permission", `--allow-fs-read=${plugin.root}`, `--allow-fs-read=${data}`, `--allow-fs-write=${data}`];
  const homeReads = (plugin.runtime.permissions.read ?? []).map((relative) => {
    const absolute = path.resolve(ctx.home, relative.slice(2));
    assertSafePath(ctx.home, absolute);
    return absolute;
  });
  for (const absolute of homeReads) args.push(`--allow-fs-read=${absolute}`);
  const homeWrites = (plugin.runtime.permissions.write ?? []).map((relative) => {
    const absolute = path.resolve(ctx.home, relative.slice(2));
    assertSafePath(ctx.home, absolute);
    return absolute;
  });
  for (const absolute of homeWrites) args.push(`--allow-fs-read=${absolute}`, `--allow-fs-write=${absolute}`);
  const notes = runtimeNoteScopes(ctx, plugin.runtime);
  const state = runtimeStateScopes(ctx, plugin.runtime);
  args.push(...notes.args, ...state.args);
  if (plugin.runtime.permissions.exec) args.push("--allow-child-process");
  if (plugin.runtime.permissions.network.length && process.allowedNodeEnvironmentFlags.has("--allow-net")) args.push("--allow-net");
  const env: NodeJS.ProcessEnv = { ...runtimeEnvironment(plugin.runtime, ctx.env, data, plugin.commandDirectories), ...notes.env, ...state.env, ...(homeReads.length || homeWrites.length ? { DEVHUB_PLUGIN_HOST_HOME: ctx.home } : {}) };
  return { data, args, env };
}

export function runtimeEnvironment(runtime: RuntimeContribution, source: NodeJS.ProcessEnv, dataDir: string, commandDirectories: string[] = []): NodeJS.ProcessEnv {
  const executableDirectories = new Set([path.dirname(process.execPath), ...commandDirectories]);
  const orderedDirectories = (source.PATH ?? "").split(path.delimiter).filter((directory) => executableDirectories.has(directory));
  const env: NodeJS.ProcessEnv = {
    HOME: dataDir, TMPDIR: dataDir, TMP: dataDir, TEMP: dataDir, NODE_ENV: "production",
    PATH: [...new Set([...orderedDirectories, path.dirname(process.execPath), ...commandDirectories, "/usr/bin", "/bin"])].join(path.delimiter),
  };
  Object.assign(env, runtimeEnvironmentValues(runtime, source));
  return env;
}

function declared(runtime: RuntimeContribution, request: RuntimeRequest): boolean {
  if (request.kind === "slot") {
    const slot = runtime.capabilities?.slots?.find((slot) => slot.id === request.path);
    if (!slot) return false;
    if (request.method === "GET") return true;
    const action = (request.body as { action?: { path?: string; method?: string } } | undefined)?.action;
    return request.method === "POST" && !!action && slot.routes.some((route) => route.path === action.path && route.method === action.method);
  }
  if (request.kind === "integration") {
    if (request.method !== "POST" || !request.body || typeof request.body !== "object") return false;
    const body = request.body as Record<string, unknown>;
    const provider = runtime.capabilities?.integrations?.find((provider) => provider.id === body.provider);
    if (!provider) return false;
    if (["accounts", "setupStatus"].includes(request.path)) return true;
    const ref = body.ref as { kind?: string } | undefined;
    const input = body.input as { action?: string } | undefined;
    const capability = request.path === "get" ? `${ref?.kind}.read` : request.path === "alerts" ? "alerts.read" : request.path === "transitions" ? "issue.transitions" : ["prepareWrite", "executeWrite"].includes(request.path) ? input?.action : undefined;
    return !!capability && provider.capabilities.some((declared) => declared === capability);
  }
  if (request.kind === "database") return !!runtime.capabilities?.database && request.method === "POST" && ["list", "preflight", "resolve", "invalidate"].includes(request.path);
  if (request.kind === "page") return request.method === "GET" && runtime.pages.some((p) => p.path === request.path);
  if (request.kind === "mcp") return request.method === "POST" && runtime.mcp.some((p) => p.name === request.path);
  return runtime.routes.some((p) => p.path === request.path && p.method === request.method);
}

const host = globalThis as typeof globalThis & { runtimePluginCalls?: Map<string, Set<AbortController>> };
const calls = host.runtimePluginCalls ??= new Map();

export function stopRuntimeWorkers(name: string): void {
  for (const controller of calls.get(name) ?? []) controller.abort();
}

/** Request-scoped processes avoid listening ports and orphaned daemon registrations. */
export async function invokeRuntime(ctx: PluginContext, name: string, request: RuntimeRequest, signal?: AbortSignal, onEvent?: (event: RuntimeEvent) => void, expectedRoot?: string, expectedRevision?: string, providerFor?: RuntimeProviderLookup): Promise<unknown> {
  return invokeRuntimeWorker(ctx, name, request, signal, onEvent, expectedRoot, undefined, expectedRevision, providerFor);
}

async function invokeRuntimeWorker(ctx: PluginContext, name: string, request: RuntimeRequest, signal?: AbortSignal, onEvent?: (event: RuntimeEvent) => void, expectedRoot?: string, injectedDecision?: HostApprovalDecision, expectedRevision?: string, providerFor?: RuntimeProviderLookup): Promise<unknown> {
  const plugin = loadRuntime(ctx, name);
  if (expectedRoot && plugin.root !== expectedRoot) throw new PluginApiError(409, "RUNTIME_CHANGED", "This plugin changed. Review the action again before continuing.");
  if (expectedRevision && plugin.revision !== expectedRevision) throw new PluginApiError(409, "RUNTIME_CHANGED", "This plugin changed. Review the action again before continuing.");
  if (!declared(plugin.runtime, request)) throw new PluginApiError(404, "RUNTIME_ROUTE", "The plugin did not declare this route.");
  const route = request.kind === "api" ? plugin.runtime.routes.find((r) => r.path === request.path && r.method === request.method) : undefined;
  const mcp = request.kind === "mcp" ? plugin.runtime.mcp.find((server) => server.name === request.path) : undefined;
  const action = request.kind === "slot" && request.body && typeof request.body === "object" ? (request.body as { action?: { path?: string; method?: string } }).action : undefined;
  const slotRoute = action && plugin.runtime.capabilities?.slots?.find(slot => slot.id === request.path)?.routes.find(route => route.path === action.path && route.method === action.method);
  const stream = route?.stream ? new RuntimeStream(event => onEvent?.(runtimeResponse(z.unknown(), event, plugin, ctx) as RuntimeEvent)) : undefined;
  if (Buffer.byteLength(JSON.stringify(request)) > 64 * 1024) throw new PluginApiError(413, "RUNTIME_SIZE", "The plugin request is too large.");
  const { data, args, env } = runtimeWorkerOptions(ctx, plugin);
  if (injectedDecision) env.DEVHUB_RUNTIME_HOST_PID = String(process.pid);
  const applySettings = prepareRuntimeSettings(plugin.runtime, request, ctx.env);
  const active = calls.get(name) ?? new Set<AbortController>();
  if (active.size >= 4) throw new PluginApiError(429, "RUNTIME_BUSY", "This plugin is busy. Try again.", true);
  calls.set(name, active);
  const controller = new AbortController();
  active.add(controller);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  // A CLI replacement must also retire calls in other server processes.
  const stillCurrent = () => {
    const entry = findEntry(ctx, name);
    return entry?.enabled && expandHome(entry.path, ctx.home) === plugin.root && runtimeApproval(readReceipt(ctx, entry.id), plugin.root)?.treeHash === plugin.revision;
  };
  const poll = setInterval(() => { if (!stillCurrent()) abort(); }, 250);
  let dataSync: Awaited<ReturnType<typeof startRuntimeDataSync>> | undefined;
  const invocation = (async () => {
    const hostReads = await prepareRuntimeReads(plugin.runtime, request, controller.signal, undefined, providerFor);
    if (controller.signal.aborted || !stillCurrent()) throw new Error("Plugin disabled, replaced or cancelled");
    if (hostReads && loadRuntime(ctx, name).revision !== plugin.revision) throw new Error("Plugin changed during host read");
    if (request.kind === "slot" && plugin.runtime.permissions.network.includes("127.0.0.1")) {
      dataSync = await startRuntimeDataSync(data);
      env.DEVHUB_RUNTIME_DATA_SYNC = dataSync.environment;
    }
    if (controller.signal.aborted || !stillCurrent() || loadRuntime(ctx, name).revision !== plugin.revision) throw new Error("Plugin changed before invocation");
    const hostApproval = injectedDecision ?? runtimeApprovalDecision(plugin, request);
    const input = JSON.stringify({ ...request, ...(hostReads ? { hostReads } : {}), ...(hostApproval ? { hostApproval } : {}) });
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("Host read snapshot too large");
    args.push(runtimeFile(plugin.root, plugin.runtime.entry));
    const result = await execExternal(process.execPath, args, {
      cwd: data, env, input,
      timeoutMs: request.kind === "database" && request.path === "list" ? (plugin.runtime.capabilities?.database?.listTimeoutSeconds ?? 3) * 1000
        : (request.kind === "database" && request.path === "invalidate") || (request.kind === "integration" && ["accounts", "setupStatus"].includes(request.path)) ? 3000 : (route?.timeoutSeconds ?? mcp?.timeoutSeconds ?? slotRoute?.timeoutSeconds ?? 30) * 1000,
      maxBuffer: ["database", "integration"].includes(request.kind) ? 256 * 1024 : 2 * 1024 * 1024, label: `plugin:${name}`, signal: controller.signal,
      onStdout: stream ? (chunk) => stream.push(chunk) : undefined,
    });
    if (!stillCurrent()) throw new Error("Plugin disabled or replaced");
    const output: unknown = stream ? stream.finish() : JSON.parse(result.stdout);
    if (request.kind === "page" && typeof output !== "string") throw new Error("Page must return HTML");
    if (output && typeof output === "object" && ["hostSettings", "hostTerminalProposal", "hostAgentRun", "hostAgentPrepare", "hostApproval", "hostBackgroundRun"].filter(key => Object.hasOwn(output, key)).length > 1) throw new Error("Multiple host writes in one request");
    const current = () => !controller.signal.aborted && !!stillCurrent() && loadRuntime(ctx, name).revision === plugin.revision;
    if (output && typeof output === "object" && Object.hasOwn(output, "hostBackgroundRun")) {
      if (injectedDecision || hostApproval?.status !== "approved" || !current()) throw new Error("Unapproved background run");
      const call = request.kind === "mcp" && request.body && typeof request.body === "object" ? request.body as { id?: unknown; method?: unknown; params?: { name?: unknown } } : undefined;
      const grants = plugin.runtime.capabilities?.backgroundRuns?.filter(grant => "server" in grant
        ? request.kind === "mcp" && request.method === "POST" && call?.method === "tools/call" && grant.server === request.path && grant.tool === call.params?.name
        : request.kind === "api" && grant.path === request.path && grant.method === request.method) ?? [];
      if (grants.length !== 1) throw new Error("Unreviewed background run");
      const runId = randomUUID();
      const marker = "__DEVHUB_BACKGROUND_RUN_ID__";
      let response: unknown;
      if (call) {
        const rpc = runtimeResponse(z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]), result: z.object({ content: z.tuple([z.object({ type: z.literal("text"), text: z.string().max(16000) }).strict()]) }).strict(), hostBackgroundRun: z.literal(true) }).strict(), output, plugin, ctx, "reject");
        if (rpc.id !== call.id || rpc.result.content[0].text.split(marker).length !== 2) throw new Error("Invalid background response");
        response = { jsonrpc: rpc.jsonrpc, id: rpc.id, result: { content: [{ type: "text", text: rpc.result.content[0].text.replace(marker, runId) }] } };
      } else {
        runtimeResponse(z.object({ status: z.literal(202), body: z.object({ ok: z.literal(true) }).strict(), hostBackgroundRun: z.literal(true) }).strict(), output, plugin, ctx, "reject");
        response = { status: 202, body: { runId } };
      }
      const background = new AbortController();
      const cancelBeforeStart = () => background.abort();
      controller.signal.addEventListener("abort", cancelBeforeStart, { once: true });
      try {
        await new Promise<void>((resolve, reject) => {
          let ready = false;
          const timer = setTimeout(() => { background.abort(); reject(new Error("Background run did not start")); }, 15000);
          void invokeRuntimeWorker(ctx, name, { kind: "api", path: grants[0].runRoute, method: "POST", body: { runId, original: request.body } }, background.signal, event => {
            if (!ready && event.type === "output" && event.text === "__DEVHUB_RUN_READY__") {
              ready = true;
              clearTimeout(timer);
              resolve();
            }
          }, plugin.root, hostApproval, plugin.revision, providerFor).then(() => {
            if (!ready) { clearTimeout(timer); reject(new Error("Background run ended before starting")); }
          }, () => {
            if (!ready) { clearTimeout(timer); reject(new Error("Background run failed to start")); }
          });
        });
      } finally { controller.signal.removeEventListener("abort", cancelBeforeStart); }
      if (!current()) { background.abort(); throw new Error("Plugin changed during background startup"); }
      return response;
    }
    return await applyRuntimeAgentRun(plugin, ctx, request, applyRuntimeTerminalProposal(plugin.runtime, request, applyRuntimeApproval(plugin, ctx, request, applySettings(output, current), current), current), current);
  })();
  let result: unknown;
  let runtimeError: unknown;
  let runtimeFailed = false;
  try {
    result = await invocation;
  } catch (error) {
    runtimeFailed = true;
    runtimeError = error;
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", abort);
    active.delete(controller);
    if (!active.size) calls.delete(name);
  }
  try {
    await dataSync?.close();
  } catch (error) {
    runtimeError = runtimeFailed ? new AggregateError([runtimeError, error], "Plugin invocation and data sync cleanup failed") : error;
    runtimeFailed = true;
  }
  if (runtimeFailed) {
    const failure = new PluginApiError(502, "RUNTIME_FAILED", "Plugin request failed. The plugin did not return a valid response before the time limit. Try again or disable it in Plugins.", true);
    failure.cause = runtimeError;
    throw failure;
  }
  return result;
}
