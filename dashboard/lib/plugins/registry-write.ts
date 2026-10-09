/** Registry edits fail closed; the read-only loader remains tolerant of broken entries. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { withMutex, writeAtomic } from "../atomic-write";
import { readManifest, PLUGIN_NAME_SLUG } from "./manifest";
import { withPluginMutationLock } from "./lock";
import { resolvePluginPaths } from "./paths";
import { secureFile } from "./runtime";
import { expandHome } from "./registry";

const registrySchema = z.object({
  plugins: z.array(z.object({
    name: z.string().optional(),
    path: z.string().min(1),
    enabled: z.boolean().optional(),
    gitRefresh: z.boolean().optional(),
  }).passthrough()).default([]),
}).passthrough();

type PluginRegistry = z.infer<typeof registrySchema>;
type RegistryEntry = PluginRegistry["plugins"][number];

function readRegistry(file: string): PluginRegistry {
  if (!fs.existsSync(file)) return { plugins: [] };
  const content = fs.readFileSync(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`Invalid plugin registry JSON in ${file}; fix it before making changes`);
  }
  const result = registrySchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid plugin registry in ${file}; expected a plugins array with local paths`);
  }
  return result.data;
}

async function writeRegistry(file: string, registry: PluginRegistry): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeAtomic(file, JSON.stringify(registry, null, 2) + "\n");
  secureFile(file);
}

/**
 * One registry change at a time, across processes (the file lock the CLI and
 * the server share) and within this one (the per-file mutex).
 */
async function withRegistry<T>(
  home: string,
  env: NodeJS.ProcessEnv | undefined,
  change: (file: string) => Promise<T>,
): Promise<T> {
  const { pluginHome, registryPath } = resolvePluginPaths(env ? { home, env } : { home });
  return withPluginMutationLock(pluginHome, () => withMutex(registryPath, () => change(registryPath)));
}

export interface PluginRegistration {
  name: string;
  path: string;
  enabled: boolean;
}

/** Registers a folder you manage. Replaces an entry with the same name or folder, as it always has. */
export async function registerPlugin(pluginPath: string, home = os.homedir(), env?: NodeJS.ProcessEnv): Promise<PluginRegistration> {
  if (!pluginPath.trim()) throw new Error("A plugin path is required");
  const dir = fs.realpathSync(expandHome(pluginPath.trim(), home));
  const result = readManifest(dir);
  if (!result.ok) throw new Error(result.error);
  const { name } = result.manifest;
  return withRegistry(home, env, async (file) => {
    const registry = readRegistry(file);
    const index = registry.plugins.findIndex(entry =>
      entry.name === name || fs.existsSync(expandHome(entry.path, home)) && fs.realpathSync(expandHome(entry.path, home)) === dir);
    const entry = { ...(index >= 0 ? registry.plugins[index] : {}), name, path: dir, enabled: true };
    if (index >= 0) registry.plugins[index] = entry; else registry.plugins.push(entry);
    await writeRegistry(file, registry);
    return { name, path: dir, enabled: true };
  });
}

export async function setPluginEnabled(name: string, enabled: boolean, home = os.homedir(), env?: NodeJS.ProcessEnv): Promise<PluginRegistration> {
  if (!PLUGIN_NAME_SLUG.test(name)) throw new Error("Plugin name must be a lowercase slug");
  return withRegistry(home, env, async (file) => {
    const registry = readRegistry(file);
    const entry = registry.plugins.find(plugin => plugin.name === name);
    if (!entry) throw new Error(`Plugin "${name}" is not registered`);
    if (enabled) {
      const manifest = readManifest(expandHome(entry.path, home));
      if (!manifest.ok) throw new Error(manifest.error);
      if (manifest.manifest.name !== name) throw new Error(`Plugin registry name "${name}" does not match manifest name "${manifest.manifest.name}"`);
    }
    entry.enabled = enabled;
    await writeRegistry(file, registry);
    return { name, path: entry.path, enabled };
  });
}

export interface ManagedSource {
  kind: "github" | "local";
  url: string | null;
  /** Full ref the download followed, e.g. "refs/heads/main". */
  ref: string | null;
  sha: string | null;
}

export interface ManagedRegistrationInput {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  source: ManagedSource;
  approvedSha: string | null;
  approvedPlanDigest: string;
  installedAt: string;
}

/**
 * Adds a downloaded plugin. Never replaces: a same-named entry, from a folder
 * or another download, stays as it is and this refuses.
 */
export async function registerManagedPlugin(
  input: ManagedRegistrationInput,
  home = os.homedir(),
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return withRegistry(home, env, async (file) => {
    const registry = readRegistry(file);
    if (registry.plugins.some((entry) => entry.name === input.name)) {
      throw new Error(`A plugin named ${input.name} is already registered from another location. Your existing plugin hasn’t changed.`);
    }
    registry.plugins.push({
      id: input.id,
      name: input.name,
      path: input.path,
      enabled: input.enabled,
      managed: true,
      source: input.source,
      approvedSha: input.approvedSha,
      approvedPlanDigest: input.approvedPlanDigest,
      installedAt: input.installedAt,
    });
    if (registry.schemaVersion === undefined) registry.schemaVersion = 2;
    await writeRegistry(file, registry);
  });
}

function entryMatching(registry: PluginRegistry, idOrName: string): number {
  return registry.plugins.findIndex((plugin: RegistryEntry) => plugin.id === idOrName || (plugin.name !== undefined && plugin.name === idOrName));
}

/** Merges fields into one entry by id or name. Other entries and fields are left alone. */
export async function patchPluginEntry(
  idOrName: string,
  patch: Record<string, unknown>,
  home = os.homedir(),
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return withRegistry(home, env, async (file) => {
    const registry = readRegistry(file);
    const index = entryMatching(registry, idOrName);
    if (index < 0) throw new Error(`Plugin "${idOrName}" is not registered`);
    Object.assign(registry.plugins[index], patch);
    await writeRegistry(file, registry);
  });
}

export async function removePluginEntry(idOrName: string, home = os.homedir(), env?: NodeJS.ProcessEnv): Promise<void> {
  return withRegistry(home, env, async (file) => {
    const registry = readRegistry(file);
    const index = entryMatching(registry, idOrName);
    if (index < 0) throw new Error(`Plugin "${idOrName}" is not registered`);
    registry.plugins.splice(index, 1);
    await writeRegistry(file, registry);
  });
}

function registryFile(home: string, env?: NodeJS.ProcessEnv): string {
  return resolvePluginPaths(env ? { home, env } : { home }).registryPath;
}

export function readRegistryFile(home = os.homedir(), env?: NodeJS.ProcessEnv): PluginRegistry {
  return readRegistry(registryFile(home, env));
}

/**
 * A fingerprint of the registry's current content. A review records it, and a
 * confirmation that finds a different one knows something else changed first.
 */
export function registryRevision(home = os.homedir(), env?: NodeJS.ProcessEnv): string {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(registryFile(home, env))).digest("hex").slice(0, 24);
  } catch {
    return "missing";
  }
}
