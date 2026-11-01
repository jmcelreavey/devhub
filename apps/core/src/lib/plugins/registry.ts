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
import { parseManifest, readManifest } from "./manifest";
import { resolvePluginPaths } from "./paths";
import {
  pluginOrigin,
  type ContributeKind,
  type PluginAssetDir,
  type RegisteredPlugin,
} from "./types";

export function pluginRegistryPath(home = os.homedir()): string {
  return resolvePluginPaths({ home }).registryPath;
}

/** Expand a leading `~` to the home directory and resolve to an absolute path. */
export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return path.resolve(p);
}

interface RawRegistryEntry {
  managed?: unknown;
  name?: unknown;
  path?: unknown;
  enabled?: unknown;
  gitRefresh?: unknown;
}

interface RawRegistry {
  plugins?: RawRegistryEntry[];
}

export type LoadWarn = (message: string) => void;

const MAX_REGISTRY_BYTES = 128 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
/** Descriptor reads are bounded even if a file grows after stat. */
function readBounded(file: string, maxBytes: number, noFollow = true): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (noFollow ? (fs.constants.O_NOFOLLOW ?? 0) : 0) | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes) throw new Error("Plugin input exceeds its file limit");
    const buffer = Buffer.allocUnsafe(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs) throw new Error("Plugin input changed during read");
    return buffer.subarray(0, offset);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Resolve all enabled, valid plugins from the registry. Entries are deduped by name
 * (first wins). Disabled entries, missing paths, and invalid manifests are skipped.
 * Bounded reads reject malformed or oversized input.
 */
export function listEnabledPlugins(
  home = os.homedir(),
  warn?: LoadWarn,
  options: { bounded?: boolean } = {},
): RegisteredPlugin[] {
  const file = pluginRegistryPath(home);
  if (!fs.existsSync(file)) return [];

  let raw: RawRegistry;
  try {
    raw = JSON.parse(options.bounded
      ? readBounded(file, MAX_REGISTRY_BYTES).toString("utf8")
      : fs.readFileSync(file, "utf-8")) as RawRegistry;
    if (options.bounded && (!Array.isArray(raw?.plugins) || raw.plugins.length > 512)) {
      throw new Error("Invalid or oversized plugin registry");
    }
  } catch (e) {
    if (options.bounded) throw e;
    warn?.(`Ignoring ${file}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
    return [];
  }

  const entries = Array.isArray(raw?.plugins) ? raw.plugins : [];
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

    let manifestResult: ReturnType<typeof readManifest>;
    if (options.bounded) {
      try {
        manifestResult = parseManifest(JSON.parse(readBounded(path.join(dir, "devhub-plugin.json"), MAX_MANIFEST_BYTES).toString("utf8")) as unknown);
      } catch (error) {
        if (error instanceof SyntaxError || ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          warn?.(`Skipping plugin at ${dir}: missing, unreadable or invalid manifest`);
          continue;
        }
        throw error;
      }
    } else {
      manifestResult = readManifest(dir);
    }
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
      ...(entry.managed === true ? { managed: true } : {}),
        gitRefresh: entry.gitRefresh === true,
      manifest: entry.managed === true && manifest.runtime ? {
        ...manifest, branding: undefined,
        contributes: { skills: manifest.contributes.skills, agents: manifest.contributes.agents },
      } : manifest,
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
    out.push({ plugin: plugin.name, origin: pluginOrigin(plugin.name), dir, pluginPath: plugin.path });
  }
  return out;
}
