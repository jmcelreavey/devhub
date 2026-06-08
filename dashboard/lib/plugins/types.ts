/**
 * Plugin system shared types.
 *
 * A plugin is a separate repo (or local dir) that contributes assets — skills, agents,
 * MCP configs, persona modes, docs — into DevHub without living in the core repo. The
 * loader merges enabled plugin assets alongside core at sync time, with core winning on
 * name collisions. See TEMPLATE_AND_PLUGIN_PLAN.md for the full design.
 */

/** File-copy asset kinds a plugin can contribute (tier 1). Dashboard modules are tier 2. */
export const CONTRIBUTE_KINDS = ["skills", "agents", "mcp", "personaModes", "docs"] as const;
export type ContributeKind = (typeof CONTRIBUTE_KINDS)[number];

/**
 * Where an asset came from. `"core"` is the DevHub repo itself; `"plugin:<name>"` is a
 * registered plugin. Kept as a string (not an object) so it serialises cleanly to the
 * dashboard UI and JSON APIs.
 */
export type AssetOrigin = "core" | `plugin:${string}`;

export function pluginOrigin(name: string): AssetOrigin {
  return `plugin:${name}`;
}

/** Contract version this DevHub understands. Plugins declare which they target. */
export const SUPPORTED_DEVHUB_API = ["1"] as const;
export type DevhubApiVersion = (typeof SUPPORTED_DEVHUB_API)[number];

/**
 * Tier-2 dashboard contribution. The materialiser copies each `paths` entry from
 * `<pluginRoot>/<root>/<path>` into the core dashboard at the same relative path (so the
 * plugin's `@/lib`, `@/components` imports resolve unchanged) and git-ignores them.
 *
 * Nav entries for plugin pages currently live as gated stubs in core `lib/nav.ts`
 * (generic plugin-contributed nav is a future enhancement).
 */
export interface DashboardContribution {
  /** Plugin-root-relative dir holding the dashboard subtree (e.g. "dashboard"). */
  root: string;
  /** Dashboard-relative paths the plugin owns (files or dirs), e.g. "app/ops", "lib/bi-ops.ts". */
  paths: string[];
}

/** Parsed `devhub-plugin.json` from a plugin repo root. */
export interface PluginManifest {
  name: string;
  version: string;
  devhubApi: DevhubApiVersion;
  /** Optional nav gate (reuses the dashboard NavGate values, e.g. "bi"). */
  navGate?: string;
  /** Map of asset kind -> path relative to the plugin root (e.g. { agents: "agents/" }). */
  contributes: Partial<Record<ContributeKind, string>>;
  /** Tier-2 dashboard module (pages, API, libs, components, nav). */
  dashboard?: DashboardContribution;
}

/** A registry entry resolved against the filesystem, with its manifest loaded. */
export interface RegisteredPlugin {
  name: string;
  /** Absolute, tilde-expanded path to the plugin root. */
  path: string;
  enabled: boolean;
  /** When true, the loader may `git pull` the plugin before reading (e.g. ai-tools). */
  gitRefresh?: boolean;
  manifest: PluginManifest;
}

/** A resolved source directory for one asset kind, tagged with its origin. */
export interface PluginAssetDir {
  plugin: string;
  origin: AssetOrigin;
  /** Absolute path to the directory holding that kind's files inside the plugin. */
  dir: string;
}
