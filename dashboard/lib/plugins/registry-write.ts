/** Registry edits fail closed; the read-only loader remains tolerant of broken entries. */
import fs from "node:fs";
import os from "node:os";
import { z } from "zod";
import { withMutex, writeAtomic } from "../atomic-write";
import { readManifest, PLUGIN_NAME_SLUG } from "./manifest";
import { expandHome, pluginRegistryPath } from "./registry";

const registrySchema = z.object({
  plugins: z.array(z.object({
    name: z.string().optional(),
    path: z.string().min(1),
    enabled: z.boolean().optional(),
    gitRefresh: z.boolean().optional(),
  }).passthrough()).default([]),
}).passthrough();

type PluginRegistry = z.infer<typeof registrySchema>;

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

export interface PluginRegistration {
  name: string;
  path: string;
  enabled: boolean;
}

export async function registerPlugin(pluginPath: string, home = os.homedir()): Promise<PluginRegistration> {
  if (!pluginPath.trim()) throw new Error("A plugin path is required");
  const dir = fs.realpathSync(expandHome(pluginPath.trim(), home));
  const result = readManifest(dir);
  if (!result.ok) throw new Error(result.error);
  const { name } = result.manifest;
  const file = pluginRegistryPath(home);
  return await withMutex(file, async () => {
    const registry = readRegistry(file);
    const index = registry.plugins.findIndex(entry =>
      entry.name === name || expandHome(entry.path, home) === dir);
    const entry = { ...(registry.plugins[index] ?? {}), name, path: dir, enabled: true };
    if (index < 0) registry.plugins.push(entry);
    else registry.plugins[index] = entry;
    await writeAtomic(file, JSON.stringify(registry, null, 2) + "\n");
    return { name, path: dir, enabled: true };
  });
}

export async function setPluginEnabled(name: string, enabled: boolean, home = os.homedir()): Promise<PluginRegistration> {
  if (!PLUGIN_NAME_SLUG.test(name)) throw new Error("Plugin name must be a lowercase slug");
  const file = pluginRegistryPath(home);
  return await withMutex(file, async () => {
    const registry = readRegistry(file);
    const entry = registry.plugins.find(plugin => plugin.name === name);
    if (!entry) throw new Error(`Plugin "${name}" is not registered`);
    if (enabled) {
      const result = readManifest(expandHome(entry.path, home));
      if (!result.ok) throw new Error(result.error);
      if (result.manifest.name !== name) throw new Error("Registry name does not match the plugin manifest");
    }
    entry.enabled = enabled;
    await writeAtomic(file, JSON.stringify(registry, null, 2) + "\n");
    return { name, path: entry.path, enabled };
  });
}
