import fs from "node:fs";
import path from "node:path";
import { execExternal } from "@/lib/exec-external";
import { PluginApiError, toolEnv, type PluginContext } from "./context";
import { assertSafePath } from "./filesystem";
import { hashFile, hashSkillDir, walkPluginRoot } from "./inspect";
import { readManifest } from "./manifest";
import { expandHome } from "./registry";
import { readReceipt } from "./store";
import { rows, findEntry } from "./views";
import { runtimeFile, verifyRuntimeFiles } from "./runtime-files";
import type { RuntimeContribution } from "./runtime-contract";
import { whichOnPath } from "./runtime";

export interface LoadedRuntime {
  id: string;
  name: string;
  root: string;
  runtime: RuntimeContribution;
  commandDirectories: string[];
}

export function loadRuntime(ctx: PluginContext, name: string): LoadedRuntime {
  const entry = findEntry(ctx, name);
  if (!entry?.enabled || !entry.managed) throw new PluginApiError(404, "RUNTIME_DISABLED", "This runtime plugin is not enabled.");
  const root = expandHome(entry.path, ctx.home);
  assertSafePath(ctx.paths.pluginHome, root);
  if (!root.startsWith(path.join(ctx.paths.pluginHome, "repos") + path.sep)) throw new Error("Runtime is outside managed storage");
  const receipt = readReceipt(ctx, entry.id);
  const manifest = readManifest(root);
  if (!receipt?.runtime || !manifest.ok || !manifest.manifest.runtime || manifest.manifest.name !== entry.name || receipt.sha !== entry.sha) throw new PluginApiError(409, "RUNTIME_CONSENT", "Review this runtime plugin before enabling it.");
  if (walkPluginRoot(root).length || hashFile(path.join(root, "devhub-plugin.json")) !== receipt.runtime.manifestHash || hashSkillDir(root) !== receipt.runtime.treeHash) throw new PluginApiError(409, "RUNTIME_CHANGED", "Runtime files changed. Review the plugin again before running it.");
  verifyRuntimeFiles(root, manifest.manifest.runtime);
  const commandDirectories = (manifest.manifest.requires?.commands ?? []).map(({ command }) => {
    const executable = whichOnPath(command, toolEnv(ctx));
    if (!executable) throw new PluginApiError(409, "RUNTIME_COMMAND", "A required plugin command is missing. Re-check requirements in Plugins.");
    return path.dirname(executable);
  });
  for (const command of manifest.manifest.runtime.permissions.commands ?? []) {
    const executable = whichOnPath(command, toolEnv(ctx));
    if (executable) commandDirectories.push(path.dirname(executable));
  }
  return { id: entry.id, name: entry.name, root, runtime: manifest.manifest.runtime, commandDirectories };
}

export function runtimeEnvironment(runtime: RuntimeContribution, source: NodeJS.ProcessEnv, dataDir: string, commandDirectories: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: dataDir, TMPDIR: dataDir, TMP: dataDir, TEMP: dataDir, NODE_ENV: "production",
    PATH: [...new Set([path.dirname(process.execPath), ...commandDirectories, "/usr/bin", "/bin"])].join(path.delimiter),
  };
  for (const name of runtime.permissions.env) if (source[name] !== undefined) env[name] = source[name];
  return env;
}

export interface RuntimeRequest {
  kind: "page" | "api" | "mcp";
  path: string;
  method: string;
  body?: unknown;
}

function declared(runtime: RuntimeContribution, request: RuntimeRequest): boolean {
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
export async function invokeRuntime(ctx: PluginContext, name: string, request: RuntimeRequest, signal?: AbortSignal): Promise<unknown> {
  const plugin = loadRuntime(ctx, name);
  if (!declared(plugin.runtime, request)) throw new PluginApiError(404, "RUNTIME_ROUTE", "The plugin did not declare this route.");
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > 64 * 1024) throw new PluginApiError(413, "RUNTIME_SIZE", "The plugin request is too large.");
  const data = path.join(ctx.paths.pluginHome, "runtime-data", plugin.id);
  assertSafePath(ctx.paths.pluginHome, data);
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  const active = calls.get(name) ?? new Set<AbortController>();
  if (active.size >= 4) throw new PluginApiError(429, "RUNTIME_BUSY", "This plugin is busy. Try again.", true);
  calls.set(name, active);
  const controller = new AbortController();
  active.add(controller);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  // Covers disable from another server worker as well as this process.
  const poll = setInterval(() => { if (!findEntry(ctx, name)?.enabled) abort(); }, 250);
  try {
    const args = ["--permission", `--allow-fs-read=${plugin.root}`, `--allow-fs-read=${data}`, `--allow-fs-write=${data}`];
    const homeReads = (plugin.runtime.permissions.read ?? []).map((relative) => {
      const absolute = path.resolve(ctx.home, relative.slice(2));
      assertSafePath(ctx.home, absolute);
      return absolute;
    });
    for (const absolute of homeReads) args.push(`--allow-fs-read=${absolute}`);
    if (plugin.runtime.permissions.exec) args.push("--allow-child-process");
    args.push(runtimeFile(plugin.root, plugin.runtime.entry));
    const result = await execExternal(process.execPath, args, {
      cwd: data, env: { ...runtimeEnvironment(plugin.runtime, ctx.env, data, plugin.commandDirectories), ...(homeReads.length ? { DEVHUB_PLUGIN_HOST_HOME: ctx.home } : {}) }, input,
      timeoutMs: 30_000, maxBuffer: 2 * 1024 * 1024, label: `plugin:${name}`, signal: controller.signal,
    });
    if (!findEntry(ctx, name)?.enabled) throw new Error("Plugin disabled");
    const output: unknown = JSON.parse(result.stdout);
    if (request.kind === "page" && typeof output !== "string") throw new Error("Page must return HTML");
    return output;
  } catch {
    throw new PluginApiError(502, "RUNTIME_FAILED", "Plugin request failed. The plugin did not return a valid response before the time limit. Try again or disable it in Plugins.", true);
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", abort);
    active.delete(controller);
    if (!active.size) calls.delete(name);
  }
}

export function runtimeCatalog(ctx: PluginContext): LoadedRuntime[] {
  return rows(ctx).flatMap((row) => {
    if (!row.enabled || !row.managed) return [];
    try { return [loadRuntime(ctx, row.name)]; }
    catch { return []; } // The Plugins page still lists invalid registrations.
  });
}
