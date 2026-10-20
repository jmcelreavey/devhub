import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { buildRuntimeInfo } from "@/lib/dashboard-runtime";
import { getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { listPersonalMcpServerNames, readPersonalMcpServer } from "@/lib/mcp/personal";
import { listEnabledPlugins, pluginAssetDirs } from "@/lib/plugins/registry";
import { pluginContext } from "@/lib/plugins/context";
import { runtimeCatalog } from "@/lib/plugins/runtime-host";
import { runtimeMcpServers } from "@/lib/plugins/runtime-mcp";
import { augmentedPathEnv, scrubDesktopRuntimeEnv } from "@/lib/process-env";
import { parseSharedMcpServerFile, listSharedMcpServerNames, readSharedMcpServer, substitutePlaceholder, substituteRepoRoot, type SharedMcpServer, type Json } from "@/lib/sync/mcp";
import { createMcpClientSession, mcpChildEnv, PLUGIN_META_KEY, TOOLSET_META_KEY, type McpCallResult, type McpToolSession } from "./mcp-catalog";

/** One MCP server a plugin contributes, ready to connect to. */
export type PluginMcpSpec = { id: string; plugin?: string } & (
  | { kind: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { kind: "http" | "sse"; url: string; headers: Record<string, string> }
);

/** A plugin server that hangs while listing its tools is skipped; DevHub's own tools still load. */
export const PLUGIN_LIST_TIMEOUT_MS = 10_000;

export interface PluginDiscovery {
  home?: string;
  repoRoot?: string | null;
  /** Runtime (packaged) plugins' MCP endpoints. Replaced in tests. */
  runtime?: () => RuntimeMcpEndpoint[];
}

export interface RuntimeMcpEndpoint { plugin: string; id: string; url: string; headers: Record<string, string> }

function runtimeEndpoints(): RuntimeMcpEndpoint[] {
  const servers = runtimeMcpServers();
  return runtimeCatalog(pluginContext()).flatMap((plugin) => plugin.runtime.mcp.flatMap((server) => {
    const id = `plugin-${plugin.name}-${server.name}`;
    const found = servers[id];
    return found ? [{ plugin: plugin.name, id, url: found.url, headers: found.headers }] : [];
  }));
}

/** Group name for a plugin's tools: `plugin:<name>`, so it can't collide with a DevHub toolset. */
export function pluginGroup(plugin: string): string { return `plugin:${plugin}`; }

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/**
 * Enabled plugin servers, shared/personal MCP catalogs and packaged plugin endpoints.
 * DevHub\'s own server is never among them,
 * and a server that needs an interactive sign-in (OAuth) is left out.
 */
export function discoverPluginMcpSpecs(options: PluginDiscovery = {}): PluginMcpSpec[] {
  const home = options.home ?? os.homedir();
  const repoRoot = options.repoRoot === undefined ? getCheckoutRoot() : options.repoRoot;
  const specs: PluginMcpSpec[] = [];
  const add = (name: string, server: SharedMcpServer | null, plugin?: string, pluginPath?: string) => {
    if (name === "devhub" || !server || server.enabled === false || (server.oauth && server.oauth.enabled !== false)) return;
    let resolved = (repoRoot ? substituteRepoRoot(server as Json, repoRoot) : server) as SharedMcpServer;
    if (pluginPath) resolved = substitutePlaceholder(resolved as Json, "PLUGIN_ROOT", pluginPath) as SharedMcpServer;
    const identity = { id: name, ...(plugin ? { plugin } : {}) };
    if (resolved.url) specs.push({ ...identity, kind: resolved.type === "sse" ? "sse" : "http", url: resolved.url, headers: stringRecord(resolved.headers) });
    else if (resolved.command) specs.push({ ...identity, kind: "stdio", command: resolved.command, args: resolved.args ?? [], env: stringRecord(resolved.env) });
  };
  const shared = repoRoot ? listSharedMcpServerNames(repoRoot) : [];
  for (const name of shared) add(name, readSharedMcpServer(repoRoot!, name));
  const pluginNames = new Set<string>();
  // The sync map is first-plugin-wins. Slack needs every enabled plugin's server.
  for (const { dir, origin, pluginPath } of pluginAssetDirs("mcp", home)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-z0-9][a-z0-9._-]*\.json$/i.test(entry.name)) continue;
      const name = entry.name.slice(0, -5);
      pluginNames.add(name);
      add(name, parseSharedMcpServerFile(path.join(dir, entry.name)), origin.replace(/^plugin:/, ""), pluginPath);
    }
  }
  for (const name of listPersonalMcpServerNames(home)) if (!shared.includes(name) && !pluginNames.has(name)) add(name, readPersonalMcpServer(home, name));
  let runtime: RuntimeMcpEndpoint[] = [];
  try { runtime = (options.runtime ?? runtimeEndpoints)(); } catch { runtime = []; }
  for (const endpoint of runtime) specs.push({ id: endpoint.id, plugin: endpoint.plugin, kind: "http", url: endpoint.url, headers: endpoint.headers });
  return specs.map((spec) => specs.filter((item) => item.id === spec.id).length > 1 ? { ...spec, id: `${spec.id}-${createHash("sha256").update(specKey(spec)).digest("hex").slice(0, 12)}` } : spec);
}

/** Changes when a plugin is installed, removed, enabled, disabled or updated, so the tool list is rebuilt. */
export function pluginToolSignature(options: PluginDiscovery = {}): string {
  const home = options.home ?? os.homedir();
  const plugins = listEnabledPlugins(home).map((plugin) => `${plugin.name}@${plugin.manifest.version}`);
  const servers = discoverPluginMcpSpecs(options).map(specKey);
  if (!plugins.length && !servers.length) return "";
  return createHash("sha256").update(JSON.stringify([plugins.sort(), servers.sort()])).digest("hex").slice(0, 16);
}

function specKey(spec: PluginMcpSpec): string {
  return JSON.stringify(spec);
}

function toolName(item: unknown): string | undefined {
  const name = item && typeof item === "object" ? (item as { name?: unknown }).name : undefined;
  return typeof name === "string" && name ? name : undefined;
}

function withTimeout<Result>(work: Promise<Result>, milliseconds: number): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), milliseconds); timer.unref?.(); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export interface PluginSessionDeps {
  discover: () => PluginMcpSpec[];
  connect: (spec: PluginMcpSpec) => McpToolSession;
  timeoutMs?: number;
}

/**
 * DevHub's own tools plus every tool the enabled plugins contribute, behind the one session the catalog
 * already uses. Plugin tools are tagged with their plugin (the Jev group) and routed back to the server
 * that owns them. A plugin server that fails or hangs is skipped, and a name DevHub already has stays DevHub's.
 */
export function createPluginAwareSession(core: McpToolSession, deps: PluginSessionDeps): McpToolSession {
  const live = new Map<string, { key: string; session: McpToolSession }>();
  const routes = new Map<string, { server: string; name: string }>();
  let listed = false;

  const drop = async (id: string) => {
    const entry = live.get(id);
    live.delete(id);
    await entry?.session.close().catch(() => { console.warn("[slack] Could not close a plugin tool connection."); });
  };

  const list = async (): Promise<readonly unknown[]> => {
    const specs = deps.discover();
    for (const id of [...live.keys()]) {
      const spec = specs.find((item) => item.id === id);
      if (!spec || specKey(spec) !== live.get(id)!.key) await drop(id);
    }
    const [coreTools, found] = await Promise.all([core.listTools(), Promise.all(specs.map(async (spec) => {
      try {
        let entry = live.get(spec.id);
        if (!entry) { entry = { key: specKey(spec), session: deps.connect(spec) }; live.set(spec.id, entry); }
        return { spec, raw: await withTimeout(entry.session.listTools(), deps.timeoutMs ?? PLUGIN_LIST_TIMEOUT_MS) };
      } catch {
        await drop(spec.id);
        console.warn(`[slack] Skipped the tools from plugin server ${spec.id}: it didn't answer.`);
        return { spec, raw: [] as readonly unknown[] };
      }
    }))]);
    const taken = new Set(coreTools.map(toolName));
    const counts = new Map<string, number>();
    for (const item of [...coreTools, ...found.flatMap(({ raw }) => raw)]) {
      const name = toolName(item);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    routes.clear();
    const fromPlugins: unknown[] = [];
    for (const { spec, raw } of found) {
      for (const item of raw) {
        const name = toolName(item);
        if (!name) continue;
        let exposed = name;
        if ((counts.get(name) ?? 0) > 1) {
          const suffix = createHash("sha256").update(JSON.stringify([spec.id, name])).digest("hex").slice(0, 16);
          exposed = `mcp_${spec.id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 32)}_${name.slice(0, 60)}_${suffix}`;
        }
        if (taken.has(exposed)) throw new Error("Duplicate MCP tool identity");
        taken.add(exposed);
        routes.set(exposed, { server: spec.id, name });
        const meta = (item as { _meta?: Record<string, unknown> })._meta;
        fromPlugins.push({ ...(item as object), name: exposed, _meta: { ...meta,
          [TOOLSET_META_KEY]: spec.plugin ? pluginGroup(spec.plugin) : `server:${spec.id}`,
          [PLUGIN_META_KEY]: spec.plugin, "devhub/server": spec.id, "devhub/originalName": name,
        } });
      }
    }
    listed = true;
    return [...coreTools, ...fromPlugins];
  };

  return {
    listTools: list,
    async callTool(name, args, signal): Promise<McpCallResult> {
      // A session made after a restart hasn't listed yet, so it doesn't know which server owns a plugin tool.
      if (!listed && deps.discover().length) await list();
      const owner = routes.get(name);
      if (!owner) return core.callTool(name, args, signal);
      const entry = live.get(owner.server);
      if (!entry) throw new Error("That plugin tool is no longer available");
      return entry.session.callTool(owner.name, args, signal);
    },
    async close() {
      const ids = [...live.keys()];
      await Promise.all([core.close(), ...ids.map(drop)]);
    },
  };
}

/** A real connection to one plugin server. The environment is a baseline plus only what the plugin itself declares. */
export function connectPluginMcp(spec: PluginMcpSpec, profile: string): McpToolSession {
  return createMcpClientSession(() => {
    if (spec.kind !== "stdio") {
      if (spec.kind === "http") return new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: spec.headers } });
      return new SSEClientTransport(new URL(spec.url), { requestInit: { headers: spec.headers }, eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...spec.headers } }) } });
    }
    const checkout = getCheckoutRoot();
    return new StdioClientTransport({
      command: spec.command, args: spec.args, stderr: "ignore", cwd: checkout ?? process.cwd(),
      env: mcpChildEnv(scrubDesktopRuntimeEnv(augmentedPathEnv()), { DEVHUB_BASE_URL: buildRuntimeInfo().baseUrl, DEVHUB_PROFILE: profile, ...spec.env }),
    });
  });
}
