/**
 * In-process MCP server sync.
 *
 * Source of truth is `mcp/shared/<name>.json` at the repo root (one canonical
 * file per server, mirroring how `skills/shared/<skill>/SKILL.md` works).
 *
 * Each canonical file has either a stdio MCP shape:
 *   { command, args?, env?, description? }
 * or a remote MCP shape:
 *   { type?, url, enabled?, description? }
 *
 * `REPO_ROOT` placeholders in command/args/env values are substituted at write
 * time. On reverse-sync (see collect-mcp.ts) absolute paths under the repo
 * root are converted back to `REPO_ROOT/...`.
 *
 * Each tool stores MCP entries in a different file with a different schema —
 * see MCP_TOOL_TARGETS below. The OpenCode transform is the odd one out (uses
 * `mcp` instead of `mcpServers`, with `{ type, command: [cmd, ...args] }`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cursorMcpConfigPath, cursorMcpLegacyConfigPath } from "./mcp-cursor-paths";
import { listPersonalMcpServerNames, readPersonalMcpServer } from "./mcp-personal";
import { pluginAssetDirs } from "./plugins/registry";
import type { AssetOrigin } from "./plugins/types";
import { readJsonObjectFile, writeJsonObjectFile, type Json } from "./json-file";

export type { Json };

/** Canonical per-server JSON stored under mcp/shared/<name>.json. */
export interface SharedMcpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
  type?: string;
  url?: string;
  enabled?: boolean;
  oauth?: Record<string, Json>;
  headers?: Record<string, string>;
}

export interface McpToolTarget {
  /** Tool id used in CLI / API arguments. */
  id: string;
  /** Display label used in emit() output. */
  label: string;
  /** Absolute path to the tool's config file (resolved via HOME). */
  configPath: (home: string) => string;
  /**
   * Extra config files merged when reading local state (e.g. legacy Cursor path).
   * Writes always go to `configPath` only.
   */
  extraReadConfigPaths?: (home: string) => string[];
  /** Top-level key the tool reads MCP entries from. */
  topKey: "mcpServers" | "mcp";
  /** Whether forward-sync should preserve other top-level keys in the file. */
  mergeRest: boolean;
  /** Canonical -> tool-specific entry transform. */
  toTool: (server: SharedMcpServer) => Json;
  /** Tool-specific entry -> canonical transform (null if shape is unknown). */
  fromTool: (entry: Json) => SharedMcpServer | null;
}

function stdioToTool(server: SharedMcpServer): Json {
  if (server.url) return remoteToTool(server);
  if (!server.command) return {};
  const out: { [key: string]: Json } = { command: server.command };
  if (server.args && server.args.length > 0) out.args = server.args;
  if (server.env && Object.keys(server.env).length > 0) out.env = server.env;
  return out;
}

function remoteToTool(server: SharedMcpServer): Json {
  if (!server.url) return {};
  const out: { [key: string]: Json } = {
    type: server.type || "remote",
    url: server.url,
  };
  if (typeof server.enabled === "boolean") out.enabled = server.enabled;
  if (server.oauth && Object.keys(server.oauth).length > 0) out.oauth = server.oauth;
  if (server.headers && Object.keys(server.headers).length > 0) out.headers = server.headers;
  return out;
}

function sharedFromTool(entry: Json): SharedMcpServer | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const url = (entry as { url?: unknown }).url;
  if (typeof url === "string" && url) {
    const type = (entry as { type?: unknown }).type;
    const enabled = (entry as { enabled?: unknown }).enabled;
    const oauth = (entry as { oauth?: unknown }).oauth;
    const headers = (entry as { headers?: unknown }).headers;
    return {
      type: typeof type === "string" ? type : "remote",
      url,
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      ...(oauth && typeof oauth === "object" && !Array.isArray(oauth) ? { oauth: oauth as Record<string, Json> } : {}),
      ...(headers && typeof headers === "object" && !Array.isArray(headers) ? { headers: headers as Record<string, string> } : {}),
    };
  }
  const cmd = (entry as { command?: unknown }).command;
  if (typeof cmd !== "string" || !cmd) return null;
  const args = (entry as { args?: unknown }).args;
  const env = (entry as { env?: unknown }).env;
  return {
    command: cmd,
    args: Array.isArray(args) ? args.filter((x): x is string => typeof x === "string") : undefined,
    env:
      env && typeof env === "object" && !Array.isArray(env)
        ? (env as Record<string, string>)
        : undefined,
  };
}

function opencodeToTool(server: SharedMcpServer): Json {
  if (server.url) return remoteToTool(server);
  if (!server.command) return {};
  const cmd = [server.command, ...(server.args ?? [])];
  const out: { [key: string]: Json } = {
    type: "local",
    command: cmd,
    enabled: true,
  };
  if (server.env && Object.keys(server.env).length > 0) out.env = server.env;
  return out;
}

function opencodeFromTool(entry: Json): SharedMcpServer | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const type = (entry as { type?: unknown }).type;
  const url = (entry as { url?: unknown }).url;
  if (typeof url === "string" && url && type !== "local") {
    const enabled = (entry as { enabled?: unknown }).enabled;
    const oauth = (entry as { oauth?: unknown }).oauth;
    const headers = (entry as { headers?: unknown }).headers;
    return {
      type: typeof type === "string" ? type : "remote",
      url,
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      ...(oauth && typeof oauth === "object" && !Array.isArray(oauth) ? { oauth: oauth as Record<string, Json> } : {}),
      ...(headers && typeof headers === "object" && !Array.isArray(headers) ? { headers: headers as Record<string, string> } : {}),
    };
  }
  if (type !== "local") return null;
  const cmdArr = (entry as { command?: unknown }).command;
  if (!Array.isArray(cmdArr) || cmdArr.length === 0) return null;
  const [cmd, ...rest] = cmdArr.filter((x): x is string => typeof x === "string");
  if (!cmd) return null;
  const env = (entry as { env?: unknown }).env;
  return {
    command: cmd,
    args: rest.length > 0 ? rest : undefined,
    env:
      env && typeof env === "object" && !Array.isArray(env)
        ? (env as Record<string, string>)
        : undefined,
  };
}

export const MCP_TOOL_TARGETS: McpToolTarget[] = [
  {
    id: "claude",
    label: "Claude",
    configPath: (home) => path.join(home, ".claude.json"),
    topKey: "mcpServers",
    mergeRest: true,
    toTool: stdioToTool,
    fromTool: sharedFromTool,
  },
  {
    id: "codex",
    label: "Codex",
    configPath: (home) => path.join(home, ".codex", "mcp.json"),
    topKey: "mcpServers",
    mergeRest: false,
    toTool: stdioToTool,
    fromTool: sharedFromTool,
  },
  {
    id: "cursor",
    label: "Cursor",
    configPath: cursorMcpConfigPath,
    extraReadConfigPaths: (home) => [cursorMcpLegacyConfigPath(home)],
    topKey: "mcpServers",
    mergeRest: false,
    toTool: stdioToTool,
    fromTool: sharedFromTool,
  },
  {
    id: "opencode",
    label: "OpenCode",
    configPath: (home) => path.join(home, ".config", "opencode", "opencode.json"),
    topKey: "mcp",
    mergeRest: true,
    toTool: opencodeToTool,
    fromTool: opencodeFromTool,
  },
];

export function mcpToolById(id: string): McpToolTarget | undefined {
  return MCP_TOOL_TARGETS.find((t) => t.id === id);
}

export function sharedMcpDir(repoRoot: string): string {
  return path.join(repoRoot, "mcp", "shared");
}

/** Replace REPO_ROOT placeholders with the actual path. Recurses into arrays/objects. */
export function substituteRepoRoot(value: Json, repoRoot: string): Json {
  if (typeof value === "string") return value.replaceAll("REPO_ROOT", repoRoot);
  if (Array.isArray(value)) return value.map((v) => substituteRepoRoot(v, repoRoot));
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteRepoRoot(v as Json, repoRoot);
    return out;
  }
  return value;
}

/** Replace a placeholder token (e.g. PLUGIN_ROOT) with a path. Recurses into arrays/objects. */
export function substitutePlaceholder(value: Json, token: string, replacement: string): Json {
  if (typeof value === "string") return value.replaceAll(token, replacement);
  if (Array.isArray(value)) return value.map((v) => substitutePlaceholder(v, token, replacement));
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitutePlaceholder(v as Json, token, replacement);
    return out;
  }
  return value;
}

/** Reverse of substituteRepoRoot — turn absolute paths under repoRoot back into REPO_ROOT/... . */
export function reverseSubstituteRepoRoot(value: Json, repoRoot: string): Json {
  const normalized = repoRoot.endsWith(path.sep) ? repoRoot.slice(0, -1) : repoRoot;
  const replace = (s: string): string => {
    if (s === normalized) return "REPO_ROOT";
    if (s.startsWith(normalized + path.sep) || s.startsWith(normalized + "/")) {
      return "REPO_ROOT" + s.slice(normalized.length);
    }
    return s;
  };
  if (typeof value === "string") return replace(value);
  if (Array.isArray(value)) return value.map((v) => reverseSubstituteRepoRoot(v, repoRoot));
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) out[k] = reverseSubstituteRepoRoot(v as Json, repoRoot);
    return out;
  }
  return value;
}

const SERVER_SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

function isValidServerName(name: string): boolean {
  return SERVER_SLUG.test(name);
}

/** Parse a single canonical MCP server JSON file (any location). */
export function parseSharedMcpServerFile(file: string): SharedMcpServer | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (typeof raw.command !== "string" && typeof raw.url !== "string") return null;
    return {
      command: typeof raw.command === "string" ? raw.command : undefined,
      args: Array.isArray(raw.args) ? raw.args.filter((x: unknown): x is string => typeof x === "string") : undefined,
      env: raw.env && typeof raw.env === "object" && !Array.isArray(raw.env) ? raw.env : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      type: typeof raw.type === "string" ? raw.type : undefined,
      url: typeof raw.url === "string" ? raw.url : undefined,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
      oauth: raw.oauth && typeof raw.oauth === "object" && !Array.isArray(raw.oauth) ? raw.oauth : undefined,
      headers: raw.headers && typeof raw.headers === "object" && !Array.isArray(raw.headers) ? raw.headers : undefined,
    };
  } catch {
    return null;
  }
}

export function readSharedMcpServer(repoRoot: string, name: string): SharedMcpServer | null {
  if (!isValidServerName(name)) return null;
  return parseSharedMcpServerFile(path.join(sharedMcpDir(repoRoot), `${name}.json`));
}

/**
 * MCP servers contributed by enabled plugins, as a name -> { file, origin } map. First
 * plugin wins among plugins; callers resolve core (repo) before this so core wins overall.
 */
export function pluginMcpServers(
  home: string,
  warn?: (line: string) => void,
): Map<string, { file: string; origin: AssetOrigin; pluginPath: string }> {
  const map = new Map<string, { file: string; origin: AssetOrigin; pluginPath: string }>();
  for (const { dir, origin, pluginPath } of pluginAssetDirs("mcp", home, warn)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const name = entry.name.replace(/\.json$/, "");
      if (!isValidServerName(name) || map.has(name)) continue;
      map.set(name, { file: path.join(dir, entry.name), origin, pluginPath });
    }
  }
  return map;
}

function mcpServersFromConfigFile(
  configPath: string,
  topKey: McpToolTarget["topKey"],
): Record<string, Json> | null {
  const existing = readJsonObjectFile(configPath);
  if (!existing) return null;
  const block = existing[topKey];
  if (!block || typeof block !== "object" || Array.isArray(block)) return {};
  return block as Record<string, Json>;
}

/** Merge MCP server maps from primary + extra read paths (later paths win on name clash). */
export function mergedLocalMcpServersForTool(tool: McpToolTarget, home: string): Record<string, Json> {
  const readPaths = [
    ...(tool.extraReadConfigPaths?.(home) ?? []),
    tool.configPath(home),
  ];
  let merged: Record<string, Json> = {};
  for (const configPath of readPaths) {
    const servers = mcpServersFromConfigFile(configPath, tool.topKey);
    if (servers) merged = { ...merged, ...servers };
  }
  return merged;
}

export function listSharedMcpServerNames(repoRoot: string): string[] {
  const dir = sharedMcpDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name.replace(/\.json$/, ""))
    .filter((n) => isValidServerName(n))
    .sort();
}

export interface SyncMcpServersOptions {
  prune?: boolean;
  dryRun?: boolean;
  /** Restrict to specific server names. Empty/omitted = all in `mcp/shared/`. */
  servers?: string[];
  /** Server names to skip writing; also never pruned from targets. */
  excludeServers?: string[];
  /** Restrict to a specific tool id. */
  tool?: string;
  emit: (line: string) => void;
  repoRoot: string;
}

export type McpCatalogSource = "repo" | "plugin" | "personal";

/**
 * Resolve a server from the catalog in precedence order: core repo wins, then enabled
 * plugins, then the machine-local personal catalog. Pass `pluginServers` to reuse a
 * precomputed map in hot loops; omit it for a self-contained lookup.
 */
export function readCatalogMcpServer(
  repoRoot: string,
  home: string,
  name: string,
  pluginServers?: Map<string, { file: string; origin: AssetOrigin; pluginPath: string }>,
): { server: SharedMcpServer; source: McpCatalogSource; pluginPath?: string } | null {
  const shared = readSharedMcpServer(repoRoot, name);
  if (shared) return { server: shared, source: "repo" };
  const fromPlugin = (pluginServers ?? pluginMcpServers(home)).get(name);
  if (fromPlugin) {
    const server = parseSharedMcpServerFile(fromPlugin.file);
    if (server) return { server, source: "plugin", pluginPath: fromPlugin.pluginPath };
  }
  const personal = readPersonalMcpServer(home, name);
  if (personal) return { server: personal, source: "personal" };
  return null;
}

export async function syncMcpServers(opts: SyncMcpServersOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const sourceDir = sharedMcpDir(repoRoot);
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(sourceDir, { recursive: true });
  }

  const home = os.homedir();
  const repoNames = listSharedMcpServerNames(repoRoot);
  const personalNames = listPersonalMcpServerNames(home);
  const pluginServerMap = pluginMcpServers(home, emit);
  const pluginNames = [...pluginServerMap.keys()];
  const allNames = [...new Set([...repoNames, ...pluginNames, ...personalNames])].sort();
  const excluded = new Set((opts.excludeServers ?? []).map((s) => s.trim()).filter(Boolean));
  let selected = opts.servers?.length
    ? allNames.filter((n) => opts.servers!.includes(n))
    : allNames;
  selected = selected.filter((n) => !excluded.has(n));

  let toolTargets = MCP_TOOL_TARGETS;
  if (opts.tool) {
    const t = mcpToolById(opts.tool);
    if (!t) {
      emit(`ERROR: Unknown tool '${opts.tool}'. Options: ${MCP_TOOL_TARGETS.map((x) => x.id).join(", ")}`);
      return 1;
    }
    toolTargets = [t];
  }

  if (excluded.size > 0) {
    emit(`Excluding from sync/prune: ${[...excluded].sort().join(", ")}`);
  }
  const repoCount = selected.filter((n) => repoNames.includes(n)).length;
  const pluginCount = selected.filter((n) => !repoNames.includes(n) && pluginServerMap.has(n)).length;
  const personalCount = selected.filter((n) => personalNames.includes(n)).length;
  const pluginPart = pluginCount > 0 ? `, ${pluginCount} plugin` : "";
  emit(
    `Syncing ${selected.length} MCP server(s) (${repoCount} repo${pluginPart}, ${personalCount} personal) to ${toolTargets.length} target(s)...`,
  );
  if (opts.dryRun) emit("(DRY RUN — no changes will be made)");

  let writes = 0;
  let prunes = 0;

  for (const tool of toolTargets) {
    const configPath = tool.configPath(home);
    emit(`[${tool.id}] ${configPath}`);

    const existing = readJsonObjectFile(configPath) ?? {};
    const existingServers = mergedLocalMcpServersForTool(tool, home);
    const nextServers: Record<string, Json> = { ...existingServers };

    for (const name of selected) {
      const resolved = readCatalogMcpServer(repoRoot, home, name, pluginServerMap);
      if (!resolved) {
        emit(`  SKIP (unreadable): ${name}`);
        continue;
      }
      const { server, source } = resolved;
      let substitutedJson = substituteRepoRoot(
        {
          ...(server.command ? { command: server.command } : {}),
          ...(server.args ? { args: server.args } : {}),
          ...(server.env ? { env: server.env } : {}),
          ...(server.type ? { type: server.type } : {}),
          ...(server.url ? { url: server.url } : {}),
          ...(typeof server.enabled === "boolean" ? { enabled: server.enabled } : {}),
          ...(server.oauth ? { oauth: server.oauth } : {}),
          ...(server.headers ? { headers: server.headers } : {}),
        } as Json,
        repoRoot,
      );
      // Plugin-contributed servers live in the plugin repo, not under REPO_ROOT — resolve
      // their PLUGIN_ROOT placeholder to the plugin's own root.
      if (source === "plugin" && resolved.pluginPath) {
        substitutedJson = substitutePlaceholder(substitutedJson, "PLUGIN_ROOT", resolved.pluginPath);
      }
      const substituted = substitutedJson as SharedMcpServer;

      const entry = tool.toTool({
        command: substituted.command,
        args: substituted.args,
        env: substituted.env,
        description: server.description,
        type: substituted.type,
        url: substituted.url,
        enabled: substituted.enabled,
        oauth: substituted.oauth,
        headers: substituted.headers,
      });

      if (opts.dryRun) {
        emit(`  WOULD WRITE: ${name} (${source})`);
        writes++;
        continue;
      }
      nextServers[name] = entry;
      emit(`  SYNCED: ${name} (${source})`);
      writes++;
    }

    if (opts.prune) {
      const personalCatalog = new Set(personalNames);
      for (const existingName of Object.keys(existingServers)) {
        if (selected.includes(existingName)) continue;
        if (excluded.has(existingName)) continue;
        // Personal catalog entries are never pruned unless removed from ~/.config/devhub/mcp-personal/
        if (personalCatalog.has(existingName)) continue;
        // Only prune entries with a recognizable MCP shape. Unknown tool-specific
        // blocks are left alone because we cannot safely round-trip them.
        if (tool.fromTool(existingServers[existingName]) === null) continue;
        if (opts.dryRun) {
          emit(`  WOULD PRUNE: ${existingName}`);
          prunes++;
          continue;
        }
        delete nextServers[existingName];
        emit(`  PRUNED: ${existingName}`);
        prunes++;
      }
    }

    if (opts.dryRun) continue;

    const merged: Record<string, Json> = tool.mergeRest ? { ...existing } : {};
    merged[tool.topKey] = nextServers;
    writeJsonObjectFile(configPath, merged);

    for (const legacyPath of tool.extraReadConfigPaths?.(home) ?? []) {
      if (legacyPath === configPath || !fs.existsSync(legacyPath)) continue;
      const legacy = readJsonObjectFile(legacyPath);
      if (!legacy?.[tool.topKey]) continue;
      const legacyBlock = legacy[tool.topKey];
      if (
        !legacyBlock ||
        typeof legacyBlock !== "object" ||
        Array.isArray(legacyBlock) ||
        Object.keys(legacyBlock as object).length === 0
      ) {
        continue;
      }
      const cleared: Record<string, Json> = tool.mergeRest ? { ...legacy } : {};
      delete cleared[tool.topKey];
      writeJsonObjectFile(legacyPath, cleared);
      emit(`  MIGRATED: cleared mcpServers from ${legacyPath} (now using ${configPath})`);
    }
  }

  emit(`Done. ${writes} write(s)${opts.prune ? `, ${prunes} prune(s)` : ""}.`);
  return 0;
}
