/**
 * Machine-local plugin registry.
 *
 * Lives at ~/.config/devhub/plugins.json (same home as the mcp-personal catalog) and is
 * never committed — each machine decides which plugins it has cloned and enabled. The
 * loader reads it to discover plugin asset directories at sync time.
 *
 * Tolerant by design: a missing registry, a disabled entry, a missing path, or a broken
 * manifest is skipped (optionally logged), never thrown — so one bad plugin can't break
 * sync for the rest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readManifest } from "./manifest";
import {
  pluginOrigin,
  type ContributeKind,
  type PluginAssetDir,
  type RegisteredPlugin,
} from "./types";

export function pluginRegistryPath(home = os.homedir()): string {
  return path.join(home, ".config", "devhub", "plugins.json");
}

/** Expand a leading `~` to the home directory and resolve to an absolute path. */
export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return path.resolve(p);
}

interface RawRegistryEntry {
  name?: unknown;
  path?: unknown;
  enabled?: unknown;
  gitRefresh?: unknown;
}

interface RawRegistry {
  plugins?: RawRegistryEntry[];
}

export type LoadWarn = (message: string) => void;

/**
 * Resolve all enabled, valid plugins from the registry. Entries are deduped by name
 * (first wins). Disabled entries, missing paths, and invalid manifests are skipped.
 */
export function listEnabledPlugins(home = os.homedir(), warn?: LoadWarn): RegisteredPlugin[] {
  const file = pluginRegistryPath(home);
  if (!fs.existsSync(file)) return [];

  let raw: RawRegistry;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8")) as RawRegistry;
  } catch (e) {
    warn?.(`Ignoring ${file}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
    return [];
  }

  const entries = Array.isArray(raw.plugins) ? raw.plugins : [];
  const seen = new Set<string>();
  const out: RegisteredPlugin[] = [];

  for (const entry of entries) {
    if (typeof entry?.path !== "string" || !entry.path.trim()) {
      warn?.("Skipping plugin registry entry with no path");
      continue;
    }
    if (entry.enabled === false) continue;

    const dir = expandHome(entry.path.trim(), home);
    if (!fs.existsSync(dir)) {
      warn?.(`Skipping plugin at ${dir}: path does not exist`);
      continue;
    }

    const manifestResult = readManifest(dir);
    if (!manifestResult.ok) {
      warn?.(`Skipping plugin at ${dir}: ${manifestResult.error}`);
      continue;
    }
    const { manifest } = manifestResult;

    // The registry name (if given) must match the manifest name to avoid confusion.
    if (typeof entry.name === "string" && entry.name.trim() && entry.name.trim() !== manifest.name) {
      warn?.(`Skipping plugin at ${dir}: registry name "${entry.name}" != manifest name "${manifest.name}"`);
      continue;
    }
    if (seen.has(manifest.name)) {
      warn?.(`Skipping duplicate plugin "${manifest.name}" at ${dir}`);
      continue;
    }
    seen.add(manifest.name);

    out.push({
      name: manifest.name,
      path: dir,
      enabled: true,
      gitRefresh: entry.gitRefresh === true,
      manifest,
    });
  }

  return out;
}

/**
 * For one asset kind, return the source directories contributed by enabled plugins, in
 * registry order. Only directories that actually exist on disk are returned. Callers
 * merge these *after* the core directory so core wins on name collisions.
 */
export function pluginAssetDirs(
  kind: ContributeKind,
  home = os.homedir(),
  warn?: LoadWarn,
): PluginAssetDir[] {
  const out: PluginAssetDir[] = [];
  for (const plugin of listEnabledPlugins(home, warn)) {
    const rel = plugin.manifest.contributes[kind];
    if (!rel) continue;
    const dir = path.resolve(plugin.path, rel);
    // Guard against `../` escapes outside the plugin root.
    if (dir !== plugin.path && !dir.startsWith(plugin.path + path.sep)) {
      warn?.(`Skipping ${kind} for plugin "${plugin.name}": path escapes plugin root`);
      continue;
    }
    if (!fs.existsSync(dir)) continue;
    out.push({ plugin: plugin.name, origin: pluginOrigin(plugin.name), dir });
  }
  return out;
}
