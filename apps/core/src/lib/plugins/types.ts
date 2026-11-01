/**
 * Plugin system shared types.
 *
 * A plugin is a separate repo (or local dir) that contributes assets — skills, agents,
 * MCP configs, persona modes, docs — into DevHub without living in the core repo. The
 * loader merges enabled plugin assets alongside core at sync time, with core winning on
 * name collisions. See docs/architecture/plugins.md for the full design.
 */

/** File-copy asset kinds a plugin can contribute. */
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

/** Reviewed navigation metadata; runtime links must target declared pages or aliases. */
export interface PluginNavItem {
  href: string;
  label: string;
  icon: string;
  group: "workspace" | "library" | "infra" | "system";
  /** Defaults to the plugin's top-level `navGate` when omitted. */
  gate?: string;
  desktopOnly?: boolean;
  sidebar?: boolean;
  shortcut?: string;
  /** When set, also appears in that section's top-bar tabs (Library / Settings / Tools). */
  section?: "library" | "system" | "infra";
}

/** Legacy branding metadata, kept for manifest review; runtime themes provide UI branding. */
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
  /** Plugin-root-relative dir of font files copied into `apps/ui/public/fonts-plugin/`. */
  fonts?: string;
  /** Default sidebar/boot brand mark (user can still change it in the IconPicker). */
  logo?: {
    /** Plugin-root-relative SVG/PNG, copied into `apps/ui/public/` as the brand image. */
    src: string;
    /** Accessible label shown next to the mark, e.g. "ACME". */
    label?: string;
  };
  /**
   * Deprecated and ignored: DevHub no longer runs OpenChamber. Still accepted so
   * existing plugin manifests keep validating under the strict schema.
   */
  openchamber?: {
    themes?: string;
    defaultDarkId?: string;
    defaultLightId?: string;
  };
  /** Plugin-root-relative PNG (>=512px) used as the desktop app icon. */
  desktopIcon?: string;
  /**
   * @deprecated Renamed to `desktopIcon` when the shell moved from Electron to
   * Tauri. Still honoured because plugins are real external repos that cannot
   * be updated atomically with core; older releases used it.
   * Remove after one release.
   */
  electronIcon?: string;
}

/**
 * A CLI tool a plugin needs present on this machine. Checked in `preinstall` (see
 * `scripts/check-plugin-requirements.mjs`) so a plugin can mandate a tool (e.g. the Infrastructure
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
  /** Portable prebuilt execution contract; checkout contributions remain independent. */
  runtime?: import("../../../../../packages/shared/ui-lib/plugins/runtime-contract").RuntimeContribution;
  name: string;
  version: string;
  devhubApi: DevhubApiVersion;
  /** Optional nav gate (reuses the dashboard NavGate values, e.g. "infra"). */
  navGate?: string;
  /** Map of asset kind -> path relative to the plugin root (e.g. { agents: "agents/" }). */
  contributes: Partial<Record<ContributeKind, string>>;
  /** Tier-3 whitelabel: theme, fonts, logo, Electron icon. */
  branding?: BrandingContribution;
  themePack?: { presets: string; requires?: string[] };
  /** Machine tooling this plugin needs (verified at install time, not by core). */
  requires?: {
    commands?: PluginRequiredCommand[];
  };
}

/** A registry entry resolved against the filesystem, with its manifest loaded. */
export interface RegisteredPlugin {
  name: string;
  /** Absolute, tilde-expanded path to the plugin root. */
  path: string;
  enabled: boolean;
  managed?: boolean;
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
  /** Absolute path to the plugin root (for `PLUGIN_ROOT` placeholder substitution). */
  pluginPath: string;
}
