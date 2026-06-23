/**
 * Plugin system shared types.
 *
 * A plugin is a separate repo (or local dir) that contributes assets — skills, agents,
 * MCP configs, persona modes, docs — into DevHub without living in the core repo. The
 * loader merges enabled plugin assets alongside core at sync time, with core winning on
 * name collisions. See docs/architecture/plugins.md for the full design.
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

/**
 * Tier-3 branding contribution. A plugin can whitelabel DevHub when it's enabled:
 * contribute a theme palette + presets, seed the default theme/mode, swap fonts, the
 * sidebar/boot logo, the OpenChamber theme, and the Electron app icon.
 *
 * Core never hard-codes any of this — the branding materialiser (`lib/plugins/branding.ts`)
 * reads these fields from whichever enabled plugin declares them and writes machine-local
 * generated files that `globals.css`, `theme-presets.ts`, the logo components and the
 * Electron launcher consume. All defaults are *seeds*: the user can still flip the theme,
 * mode, or logo afterwards.
 */
export interface BrandingContribution {
  /**
   * Plugin-root-relative CSS file holding the palette blocks
   * (`:root[data-theme=...][data-theme-preset=<id>]`) and any `@font-face` declarations.
   * Font `url(...)` references should point at `/fonts-plugin/<file>` (see `fonts`).
   */
  themeCss?: string;
  /**
   * Plugin-root-relative JSON: an array of `{ id, label, description, darkSwatch,
   * lightSwatch }` preset descriptors merged into the theme-preset picker.
   */
  presets?: string;
  /** Preset id seeded as the default when this plugin is enabled (must exist in `presets`). */
  defaultPreset?: string;
  /** Default colour mode seeded on first run: `"dark" | "light" | "system"`. */
  defaultMode?: "dark" | "light" | "system";
  /** Plugin-root-relative dir of font files copied into `dashboard/public/fonts-plugin/`. */
  fonts?: string;
  /** Default sidebar/boot brand mark (user can still change it in the IconPicker). */
  logo?: {
    /** Plugin-root-relative SVG/PNG, copied into `dashboard/public/` as the brand image. */
    src: string;
    /** Accessible label shown next to the mark, e.g. "ACME". */
    label?: string;
  };
  /** OpenChamber whitelabel (applied only when OpenChamber is installed). */
  openchamber?: {
    /** Plugin-root-relative dir of OpenChamber theme JSON files. */
    themes?: string;
    /** Theme id seeded as OpenChamber's default dark theme. */
    defaultDarkId?: string;
    /** Theme id seeded as OpenChamber's default light theme. */
    defaultLightId?: string;
  };
  /** Plugin-root-relative PNG (>=512px) used as the Electron app icon. */
  electronIcon?: string;
}

/**
 * A CLI tool a plugin needs present on this machine. Checked in `preinstall` (see
 * `scripts/check-plugin-requirements.mjs`) so a plugin can mandate a tool (e.g. the BI
 * plugin requires `safe-chain`) without the core template forcing it on every forker.
 */
export interface PluginRequiredCommand {
  /** Executable expected on PATH, e.g. "safe-chain". */
  command: string;
  /** Human hint shown when it's missing, e.g. "npm install -g @aikidosec/safe-chain". */
  install?: string;
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
  /** Tier-3 whitelabel: theme, fonts, logo, OpenChamber theme, Electron icon. */
  branding?: BrandingContribution;
  /** Machine tooling this plugin needs (verified at install time, not by core). */
  requires?: { commands?: PluginRequiredCommand[] };
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
