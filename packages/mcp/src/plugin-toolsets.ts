import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { resolvePluginRegistryPath } from "./plugin-registry.ts";
import type { Context } from "./context.ts";
import { blocksToText, textToBlocks } from "./convert.ts";
import { withDashboardErrors } from "./dashboard-client.ts";
import { selectToolsets } from "./toolsets.ts";
import { prepareRuntimeToolset } from "./runtime-toolsets.ts";

const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const MODULE_PATH = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:ts|mts|js|mjs)$/;
const SAFE_FILE_PATH = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:ts|mts|js|mjs|json)$/;
const EXPORT_NAME = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const MAX_JSON_BYTES = 128 * 1024;
const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;
const MAX_PLUGIN_SOURCE_FILE_BYTES = 1024 * 1024;
const MAX_PLUGIN_SOURCE_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_IMPORTED_PLUGIN_MODULES = 256;
const MAX_UNNAMED_IDENTITY_ENTRIES = 128;
const MAX_UNNAMED_IDENTITY_BYTES = 4 * 1024 * 1024;

type ScopedPluginImport = (specifier: string, parent: string) => Promise<unknown>;

interface CachedPluginModule {
  fingerprint: string;
  imported: Promise<unknown>;
}

const importedPluginModules = new Map<string, CachedPluginModule>();
const importedPluginDeclarations = new Map<string, string>();
let scopedPluginImport: Promise<ScopedPluginImport> | undefined;

export const pluginMcpApi = Object.freeze({ z, blocksToText, textToBlocks, withDashboardErrors });

export type PluginToolServer = Pick<McpServer, "registerTool">;

export interface PluginToolset {
  plugin: string;
  name: string;
  extends?: string;
  tools: readonly string[];
  register?: (server: PluginToolServer, ctx: Context, api: typeof pluginMcpApi) => void;
  isEnabled: () => boolean;
}

interface PlannedToolsetBase {
  plugin: string;
  root: string;
  name: string;
  extends?: string;
  tools: string[];
  declarationFingerprint: string;
}

interface PlannedSourceToolset extends PlannedToolsetBase {
  runtime?: never;
  module: string;
  moduleFile: string;
  exportName: string;
  dependencies: string[];
}

interface PlannedRuntimeToolset extends PlannedToolsetBase { runtime: string }
type PlannedToolset = PlannedSourceToolset | PlannedRuntimeToolset;

interface PlannedPlugin {
  plugin: string;
  toolsets: PlannedToolset[];
}

interface LoadPluginToolsetsOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  reservedToolsets: readonly string[];
  reservedTools: ReadonlySet<string> | (() => ReadonlySet<string>);
  onError?: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${label}: unexpected field(s): ${unexpected.join(", ")}`);
}

function expandPluginPath(value: string, home: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return path.join(home, trimmed.slice(2));
  if (!path.isAbsolute(trimmed)) throw new Error("MCP plugin path must be absolute or start with ~/");
  return path.resolve(trimmed);
}

function safeFile(root: string, relative: string): string {
  if (!SAFE_FILE_PATH.test(relative) || relative.includes("\\")) throw new Error(`Invalid MCP plugin path: ${relative}`);
  const parts = relative.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const entry = fs.lstatSync(current);
    if (entry.isSymbolicLink()) throw new Error(`MCP plugin path contains a symlink: ${relative}`);
    if (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error(`MCP plugin path is not a regular file: ${relative}`);
    }
  }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(current);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error(`MCP plugin path escapes its root: ${relative}`);
  return realFile;
}

function readBoundedFile(file: string, maxBytes: number, tooLarge: string, noFollow = false): Buffer {
  const flags = fs.constants.O_RDONLY | (noFollow ? (fs.constants.O_NOFOLLOW ?? 0) : 0);
  const descriptor = fs.openSync(file, flags);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) throw new Error(`MCP plugin input is not a regular file: ${file}`);
    if (before.size > maxBytes) throw new Error(`${tooLarge}: ${file}`);
    const content = Buffer.allocUnsafe(before.size + 1);
    let offset = 0;
    while (offset < content.length) {
      const count = fs.readSync(descriptor, content, offset, content.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error(`MCP plugin input changed while reading: ${file}`);
    }
    return content.subarray(0, offset);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readJsonDocument(file: string, maxBytes = MAX_JSON_BYTES, noFollow = false): { value: unknown; content: Buffer } {
  const content = readBoundedFile(file, maxBytes, "MCP plugin JSON is too large", noFollow);
  return { value: JSON.parse(content.toString("utf8")) as unknown, content };
}

function readJsonFile(file: string, maxBytes = MAX_JSON_BYTES): unknown {
  return readJsonDocument(file, maxBytes).value;
}

function fingerprintDeclarations(manifest: Buffer, descriptor: Buffer): string {
  const hash = createHash("sha256");
  for (const content of [manifest, descriptor]) {
    hash.update(String(content.length) + ":");
    hash.update(content);
  }
  return hash.digest("hex");
}

function registryEntries(file: string): Record<string, unknown>[] {
  let raw: unknown;
  try {
    raw = readJsonFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Cannot read plugin registry ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(raw) || !Array.isArray(raw.plugins)) {
    throw new Error(`Invalid plugin registry: ${file}`);
  }
  return raw.plugins.filter(isRecord);
}

function isLocalEnabled(entry: Record<string, unknown>): boolean {
  return entry.enabled === true && (entry.managed === undefined || entry.managed === false);
}

function registryIdentityCounts(entries: Record<string, unknown>[], home: string): Map<string, number> {
  const counts = new Map<string, number>();
  let unnamedEntries = 0;
  let remainingBytes = MAX_UNNAMED_IDENTITY_BYTES;
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    let name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) {
      if (typeof entry.path !== "string" || !entry.path.trim()) continue;
      const pluginPath = entry.path.trim();
      if (!path.isAbsolute(pluginPath) && pluginPath !== "~" && !pluginPath.startsWith("~/")) {
        throw new Error("Unnamed plugin with a relative path has ambiguous identity; use an absolute path or add a registry name");
      }
      const manifestFile = path.join(expandPluginPath(pluginPath, home), "devhub-plugin.json");
      let stat: fs.Stats;
      try {
        stat = fs.statSync(manifestFile);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_PLUGIN_MANIFEST_BYTES) continue;
      unnamedEntries += 1;
      if (unnamedEntries > MAX_UNNAMED_IDENTITY_ENTRIES) throw new Error("MCP plugin identity entry limit exceeded");
      if (stat.size > remainingBytes) throw new Error("MCP plugin identity byte limit exceeded");
      let content: Buffer;
      try {
        content = readBoundedFile(manifestFile, Math.min(MAX_PLUGIN_MANIFEST_BYTES, remainingBytes), "MCP plugin identity byte limit exceeded");
      } catch (error) {
        if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw error;
      }
      remainingBytes -= content.length;
      let manifest: unknown;
      try {
        manifest = JSON.parse(content.toString("utf8")) as unknown;
      } catch {
        continue;
      }
      name = isRecord(manifest) && typeof manifest.name === "string" && SLUG.test(manifest.name) ? manifest.name : "";
    }
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function resolveRoot(entry: Record<string, unknown>, home: string, env: NodeJS.ProcessEnv): string {
  if (typeof entry.path !== "string") throw new Error("MCP plugin registry entry has no path");
  const root = expandPluginPath(entry.path, home);
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`MCP plugin root must be a real directory: ${root}`);
  const realRoot = fs.realpathSync(root);
  if (env.WSL_DISTRO_NAME && /^\/mnt\/[a-z](?:\/|$)/i.test(realRoot)) {
    throw new Error("MCP plugin root must stay inside the DevHub WSL distro");
  }
  return realRoot;
}

type DashboardManifestReader = (root: string) => { ok: true; manifest: { name: string } } | { ok: false };

let manifestReaderPromise: Promise<DashboardManifestReader> | undefined;

function dashboardManifestReader(): Promise<DashboardManifestReader> {
  if (!manifestReaderPromise) {
    manifestReaderPromise = import("../../../apps/core/src/lib/plugins/manifest.ts").then((imported: unknown) => {
      if (!isRecord(imported)) throw new Error("Dashboard plugin manifest validator is unavailable");
      const fallback = isRecord(imported.default) ? imported.default.readManifest : undefined;
      const reader = imported.readManifest ?? fallback;
      if (typeof reader !== "function") throw new Error("Dashboard plugin manifest validator is unavailable");
      return reader as DashboardManifestReader;
    });
  }
  return manifestReaderPromise;
}

function readManifest(root: string, reader: DashboardManifestReader): { name: string; content: Buffer } {
  const document = readJsonDocument(safeFile(root, "devhub-plugin.json"), MAX_PLUGIN_MANIFEST_BYTES, true);
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-manifest-"));
  try {
    fs.writeFileSync(path.join(snapshot, "devhub-plugin.json"), document.content, { mode: 0o600, flag: "wx" });
    const result = reader(snapshot);
    if (!result.ok || !isDeepStrictEqual(result.manifest, document.value)) throw new Error(`Invalid MCP plugin manifest: ${root}`);
    return { name: result.manifest.name, content: document.content };
  } finally {
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
}

function requireStringList(value: unknown, label: string, regex: RegExp, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max ||
      !value.every((item) => typeof item === "string" && regex.test(item))) {
    throw new Error(`Invalid ${label}`);
  }
  if (new Set(value).size !== value.length) throw new Error(`Duplicate ${label}`);
  return value as string[];
}

function reportPluginError(options: LoadPluginToolsetsOptions, message: string): void {
  if (options.onError) options.onError(message);
  else console.error(`DevHub MCP plugin: ${message}`);
}

async function planPluginToolsets(options: LoadPluginToolsetsOptions, registry: string, home: string, env: NodeJS.ProcessEnv): Promise<PlannedToolset[]> {
  const entries = registryEntries(registry);
  let identityCounts: Map<string, number>;
  try {
    identityCounts = registryIdentityCounts(entries, home);
  } catch (error) {
    reportPluginError(options, error instanceof Error ? error.message : String(error));
    return [];
  }

  const candidates: PlannedPlugin[] = [];
  for (const entry of entries) {
    if (!isLocalEnabled(entry) && !(entry.enabled === true && entry.managed === true)) continue;
    const label = typeof entry.name === "string" ? entry.name : "unnamed";
    let root: string;
    try {
      root = resolveRoot(entry, home, env);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") reportPluginError(options, `${label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let descriptorFile: string;
    try {
      descriptorFile = safeFile(root, "devhub-mcp-toolsets.json");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") reportPluginError(options, `${label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    try {
      const manifest = readManifest(root, await dashboardManifestReader());
      const plugin = manifest.name;
      if (entry.name !== undefined && (typeof entry.name !== "string" || entry.name !== plugin)) {
        throw new Error(`Plugin registry name does not match manifest: ${plugin}`);
      }
      const descriptorDocument = readJsonDocument(descriptorFile, MAX_JSON_BYTES, true);
      const descriptor = descriptorDocument.value;
      const declarationFingerprint = fingerprintDeclarations(manifest.content, descriptorDocument.content);
      if (!isRecord(descriptor)) throw new Error(`Invalid MCP descriptor: ${plugin}`);
      requireKeys(descriptor, ["version", "toolsets"], `MCP descriptor ${plugin}`);
      // Managed snapshots never import source registrars, including an old v1 descriptor.
      if (entry.managed === true && descriptor.version === 1) continue;
      if (descriptor.version !== (entry.managed === true ? 2 : 1) || !Array.isArray(descriptor.toolsets) || descriptor.toolsets.length === 0 || descriptor.toolsets.length > 32) {
        throw new Error(`Invalid MCP descriptor: ${plugin}`);
      }
      const toolsets: PlannedToolset[] = [];
      const toolsetNames = new Set([...options.reservedToolsets, "all", "off", "constructor", "prototype"]);
      const toolNames = new Set<string>();
      const modules = new Set<string>();
      for (const item of descriptor.toolsets) {
        if (!isRecord(item)) throw new Error(`Invalid MCP toolset: ${plugin}`);
        requireKeys(item, descriptor.version === 2 ? ["name", "extends", "runtime", "tools"] : ["name", "extends", "module", "export", "dependencies", "tools"], `MCP toolset ${plugin}`);
        if (typeof item.name !== "string" || !SLUG.test(item.name) ||
            (item.extends !== undefined && (typeof item.extends !== "string" || !options.reservedToolsets.includes(item.extends)))) {
          throw new Error(`Invalid MCP toolset: ${plugin}`);
        }
        if (toolsetNames.has(item.name)) throw new Error(`MCP toolset collision: ${item.name}`);
        toolsetNames.add(item.name);
        const tools = requireStringList(item.tools, `MCP tool names for ${item.name}`, SLUG, 256);
        for (const name of tools) {
          if (toolNames.has(name)) throw new Error(`MCP tool collision: ${name}`);
          toolNames.add(name);
        }
        const base = { plugin, root, name: item.name, extends: item.extends as string | undefined, tools, declarationFingerprint };
        if (descriptor.version === 2) {
          if (typeof item.runtime !== "string" || !SLUG.test(item.runtime)) throw new Error(`Invalid runtime MCP server: ${plugin}`);
          toolsets.push({ ...base, runtime: item.runtime });
          continue;
        }
        if (typeof item.module !== "string" || !MODULE_PATH.test(item.module) || typeof item.export !== "string" || !EXPORT_NAME.test(item.export)) {
          throw new Error(`Invalid MCP toolset: ${plugin}`);
        }
        const moduleFile = safeFile(root, item.module);
        if (modules.has(moduleFile)) throw new Error(`MCP module collision: ${item.module}`);
        modules.add(moduleFile);
        const dependencies = item.dependencies === undefined ? [] : requireStringList(item.dependencies, `MCP dependencies for ${item.name}`, MODULE_PATH, 128);
        for (const dependency of dependencies) safeFile(root, dependency);
        toolsets.push({ ...base, module: item.module, moduleFile, exportName: item.export, dependencies });
      }
      candidates.push({ plugin, toolsets });
    } catch (error) {
      reportPluginError(options, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const uniqueCandidates = candidates.filter((candidate) => {
    if (identityCounts.get(candidate.plugin) === 1) return true;
    reportPluginError(options, `Duplicate enabled plugin: ${candidate.plugin}`);
    return false;
  });
  if (!uniqueCandidates.length) return [];

  const coreTools = typeof options.reservedTools === "function" ? options.reservedTools() : options.reservedTools;
  const reservedTools = new Set([...coreTools, "constructor", "prototype"]);
  const eligible = uniqueCandidates.filter((candidate) => {
    const collision = candidate.toolsets.flatMap((toolset) => toolset.tools).find((name) => reservedTools.has(name));
    if (!collision) return true;
    reportPluginError(options, `${candidate.plugin}: MCP tool collision: ${collision}`);
    return false;
  });

  const claims = new Map<string, PlannedPlugin[]>();
  for (const candidate of eligible) {
    for (const toolset of candidate.toolsets) {
      const names = [`toolset:${toolset.name}`, ...("moduleFile" in toolset ? [`module:${toolset.moduleFile}`] : []), ...toolset.tools.map((name) => `tool:${name}`)];
      for (const name of names) claims.set(name, [...(claims.get(name) ?? []), candidate]);
    }
  }
  const conflicted = new Set<PlannedPlugin>();
  for (const [claim, owners] of claims) {
    if (owners.length < 2) continue;
    for (const owner of owners) conflicted.add(owner);
    reportPluginError(options, `MCP ${claim.replace(":", " collision: ")} (${owners.map((owner) => owner.plugin).join(", ")})`);
  }
  return eligible.filter((candidate) => !conflicted.has(candidate)).flatMap((candidate) => candidate.toolsets);
}

function stillEnabled(plan: PlannedToolset, registry: string, home: string, env: NodeJS.ProcessEnv, onIdentityError?: (message: string) => void): boolean {
  try {
    const entries = registryEntries(registry);
    let identityCount: number | undefined;
    try {
      identityCount = registryIdentityCounts(entries, home).get(plan.plugin);
    } catch (error) {
      onIdentityError?.(error instanceof Error ? error.message : String(error));
      return false;
    }
    if (identityCount !== 1) {
      if ((identityCount ?? 0) > 1) onIdentityError?.("Duplicate enabled plugin: " + plan.plugin);
      return false;
    }
    const matches = entries.filter((entry) => {
      if (entry.enabled !== true) return false;
      if (entry.name === plan.plugin) return true;
      if (entry.name !== undefined || typeof entry.path !== "string") return false;
      try {
        return resolveRoot(entry, home, env) === plan.root;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1 || !(plan.runtime ? matches[0].managed === true : isLocalEnabled(matches[0]))) return false;
    if (resolveRoot(matches[0], home, env) !== plan.root) return false;
    verifyDeclarations(plan);
    return true;
  } catch {
    return false;
  }
}

function verifyDeclarations(plan: PlannedToolset): void {
  const manifest = readBoundedFile(safeFile(plan.root, "devhub-plugin.json"), MAX_PLUGIN_MANIFEST_BYTES, "MCP plugin JSON is too large", true);
  const descriptor = readBoundedFile(safeFile(plan.root, "devhub-mcp-toolsets.json"), MAX_JSON_BYTES, "MCP plugin JSON is too large", true);
  if (fingerprintDeclarations(manifest, descriptor) !== plan.declarationFingerprint) {
    throw new Error("MCP plugin declaration changed; restart the MCP peer: " + plan.plugin);
  }
}

function sourceFingerprint(plan: PlannedSourceToolset): string {
  verifyDeclarations(plan);
  const hash = createHash("sha256");
  hash.update(JSON.stringify([plan.plugin, plan.root, plan.declarationFingerprint]));
  hash.update("\0");
  let remaining = MAX_PLUGIN_SOURCE_TOTAL_BYTES;
  for (const relative of [plan.module, ...plan.dependencies]) {
    const file = safeFile(plan.root, relative);
    const content = readBoundedFile(file, Math.min(MAX_PLUGIN_SOURCE_FILE_BYTES, remaining), "MCP plugin source exceeds byte limit", true);
    remaining -= content.length;
    hash.update(String(Buffer.byteLength(relative)) + ":" + relative + ":" + content.length + ":");
    hash.update(content);
  }
  return hash.digest("hex");
}

function sourceMatches(plan: PlannedSourceToolset, fingerprint: string): boolean {
  try {
    return sourceFingerprint(plan) === fingerprint;
  } catch {
    return false;
  }
}

function pluginImporter(): Promise<ScopedPluginImport> {
  if (!scopedPluginImport) {
    scopedPluginImport = Promise.all([import("tsx/cjs/api"), import("tsx/esm/api")]).then(([cjs, esm]) => {
      const namespace = "devhub-mcp-" + randomUUID();
      cjs.register({ namespace });
      const loader = esm.register({ namespace, tsconfig: false });
      return (specifier, parent) => loader.import(specifier, parent) as Promise<unknown>;
    });
  }
  return scopedPluginImport;
}

function cachedPluginModule(plan: PlannedSourceToolset, enabled: () => boolean): CachedPluginModule {
  const fingerprint = sourceFingerprint(plan);
  const pluginKey = JSON.stringify([plan.plugin, plan.root]);
  const checkDeclaration = () => {
    const previous = importedPluginDeclarations.get(pluginKey);
    if (previous !== undefined && previous !== plan.declarationFingerprint) {
      throw new Error("MCP plugin declaration changed; restart the MCP peer: " + plan.plugin);
    }
  };
  checkDeclaration();
  const cached = importedPluginModules.get(plan.moduleFile);
  if (cached) {
    if (cached.fingerprint !== fingerprint) throw new Error("MCP plugin source changed; restart the MCP peer: " + plan.plugin + "/" + plan.module);
    return cached;
  }
  if (importedPluginModules.size >= MAX_IMPORTED_PLUGIN_MODULES) throw new Error("MCP plugin module limit reached; restart the MCP peer");
  let started = false;
  const imported = pluginImporter().then((load) => {
    if (!enabled() || !sourceMatches(plan, fingerprint)) throw new Error("MCP plugin changed or was disabled before import: " + plan.plugin);
    checkDeclaration();
    importedPluginDeclarations.set(pluginKey, plan.declarationFingerprint);
    started = true;
    return load(pathToFileURL(plan.moduleFile).href, import.meta.url);
  });
  const entry = { fingerprint, imported };
  importedPluginModules.set(plan.moduleFile, entry);
  void imported.catch(() => {
    if (!started && importedPluginModules.get(plan.moduleFile) === entry) importedPluginModules.delete(plan.moduleFile);
  });
  return entry;
}

export async function loadPluginToolsets(options: LoadPluginToolsetsOptions): Promise<PluginToolset[]> {
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const registry = resolvePluginRegistryPath(home, env).registryPath;
  const plans = await planPluginToolsets(options, registry, home, env);
  if (!plans.length) return [];
  const available = [...options.reservedToolsets, ...plans.filter((plan) => !plan.extends).map((plan) => plan.name)];
  const selected = new Set(selectToolsets(env.DEVHUB_MCP_TOOLSETS, available).names);
  const loaded: PluginToolset[] = [];
  const plugins = new Map<string, PlannedToolset[]>();
  for (const plan of plans) {
    plugins.set(plan.plugin, [...(plugins.get(plan.plugin) ?? []), plan]);
  }
  for (const [plugin, toolsets] of plugins) {
    const pluginTools: PluginToolset[] = [];
    try {
      for (const plan of toolsets) {
        let reportedIdentityError: string | undefined;
        const checkEnabled = (): boolean => {
          let identityError: string | undefined;
          const enabled = stillEnabled(plan, registry, home, env, (message) => { identityError = message; });
          if (identityError !== reportedIdentityError) {
            reportedIdentityError = identityError;
            if (identityError) reportPluginError(options, identityError);
          }
          return enabled;
        };
        if (!checkEnabled()) throw new Error(`MCP plugin is no longer enabled and trusted: ${plugin}`);
        let register: PluginToolset["register"];
        let fingerprint: string | undefined;
        let runtimeEnabled: (() => boolean) | undefined;
        if (plan.runtime !== undefined) {
          const runtime = await prepareRuntimeToolset({ home, env, plugin, root: plan.root, server: plan.runtime, tools: plan.tools, selected: selected.has(plan.extends ?? plan.name) });
          register = runtime.register;
          runtimeEnabled = runtime.isEnabled;
        } else if (selected.has(plan.extends ?? plan.name)) {
          const cached = cachedPluginModule(plan, checkEnabled);
          fingerprint = cached.fingerprint;
          const imported = await cached.imported;
          if (!sourceMatches(plan, fingerprint)) throw new Error("MCP plugin source changed; restart the MCP peer: " + plugin + "/" + plan.module);
          if (!isRecord(imported) || !Object.hasOwn(imported, plan.exportName) || typeof imported[plan.exportName] !== "function") {
            throw new Error(`MCP plugin export not found: ${plugin}/${plan.exportName}`);
          }
          register = imported[plan.exportName] as NonNullable<PluginToolset["register"]>;
        }
        if (!checkEnabled()) throw new Error(`MCP plugin is no longer enabled and trusted: ${plugin}`);
        pluginTools.push({
          plugin,
          name: plan.name,
          extends: plan.extends,
          tools: plan.tools,
          register,
          isEnabled: () => checkEnabled() && (plan.runtime !== undefined ? !!runtimeEnabled?.() : fingerprint === undefined || sourceMatches(plan, fingerprint)),
        });
      }
      loaded.push(...pluginTools);
    } catch (error) {
      reportPluginError(options, `${plugin}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return loaded;
}
