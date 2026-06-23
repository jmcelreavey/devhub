import type { ThemeMode } from "./theme-presets-types";
import {
  PLUGIN_THEME_PRESETS,
  PLUGIN_DEFAULT_PRESET,
  PLUGIN_DEFAULT_MODE,
} from "./plugin-branding.generated";

export type { ThemeMode } from "./theme-presets-types";

/**
 * The colour mode the *user picked*. "system" follows the OS `prefers-color-scheme`;
 * "dark"/"light" pin it. The applied `data-theme` attribute is always resolved to a
 * concrete `ThemeMode` ("dark" | "light"); `data-theme-mode` remembers the setting so we
 * can re-resolve when the OS preference flips.
 */
export type ThemeModeSetting = "dark" | "light" | "system";

export const THEME_MODE_KEY = "devhub:theme";
export const THEME_PRESET_KEY = "devhub:theme-preset";
export const THEME_EVENT = "devhub:theme-change";

/** Core palettes shipped by DevHub. Plugins can append more via branding. */
export const CORE_THEME_PRESETS = [
  {
    id: "forest",
    label: "Forest Fizz",
    description: "Dark green + black",
    darkSwatch: "#0a1611",
    lightSwatch: "#eef8f2",
  },
  {
    id: "midnight",
    label: "Midnight Blue",
    description: "Deep navy + electric blue",
    darkSwatch: "#0d1524",
    lightSwatch: "#eef4ff",
  },
  {
    id: "graphite",
    label: "Graphite Neon",
    description: "Charcoal + lime",
    darkSwatch: "#121417",
    lightSwatch: "#f5f7f8",
  },
  {
    id: "tokyo",
    label: "Tokyo Night",
    description: "Indigo slate + cyan",
    darkSwatch: "#1a1b26",
    lightSwatch: "#f0f4ff",
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    description: "Plum gray + mauve",
    darkSwatch: "#1e1e2e",
    lightSwatch: "#eff1f5",
  },
] as const;

export type ThemePresetMeta = {
  id: string;
  label: string;
  description: string;
  darkSwatch: string;
  lightSwatch: string;
};

/**
 * The preset list the UI renders: core palettes plus any plugin-contributed ones.
 * Core wins on id collisions, and plugin presets are appended in declaration order.
 */
export const THEME_PRESETS: ThemePresetMeta[] = (() => {
  const coreIds = new Set<string>(CORE_THEME_PRESETS.map((p) => p.id));
  const extra = PLUGIN_THEME_PRESETS.filter((p) => !coreIds.has(p.id));
  return [...CORE_THEME_PRESETS, ...extra];
})();

export type ThemePresetId = string;

/**
 * Core fallback default. The active default is `DEFAULT_THEME_PRESET_ID` below, which a
 * branding plugin can override.
 */
export const CORE_DEFAULT_THEME_PRESET_ID = "graphite";

const VALID_PRESET_IDS = new Set<string>(THEME_PRESETS.map((p) => p.id));

/** Default palette — a branding plugin may seed its own, else core "graphite". */
export const DEFAULT_THEME_PRESET_ID: ThemePresetId =
  PLUGIN_DEFAULT_PRESET && VALID_PRESET_IDS.has(PLUGIN_DEFAULT_PRESET)
    ? PLUGIN_DEFAULT_PRESET
    : CORE_DEFAULT_THEME_PRESET_ID;

/** Default colour-mode setting — a branding plugin may seed its own, else "system". */
export const DEFAULT_THEME_MODE_SETTING: ThemeModeSetting = PLUGIN_DEFAULT_MODE ?? "system";

export function sanitizeMode(value: string | null | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}

/** Coerce an arbitrary stored value into a valid mode *setting*. */
export function sanitizeModeSetting(value: string | null | undefined): ThemeModeSetting {
  if (value === "light" || value === "dark" || value === "system") return value;
  return DEFAULT_THEME_MODE_SETTING;
}

export function sanitizePreset(value: string | null | undefined): ThemePresetId {
  if (value && VALID_PRESET_IDS.has(value)) {
    return value;
  }
  return DEFAULT_THEME_PRESET_ID;
}

/** Resolve a mode setting to a concrete dark/light, consulting the OS for "system". */
export function resolveMode(setting: ThemeModeSetting): ThemeMode {
  if (setting === "dark" || setting === "light") return setting;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  // SSR / no matchMedia: default to dark to match the static <html data-theme> fallback.
  return "dark";
}

/** `useSyncExternalStore` subscription — theme changes, cross-tab storage, and OS scheme. */
export function subscribeThemeSelection(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  const mq =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  // Re-resolve when the OS flips while the user is on "system".
  mq?.addEventListener?.("change", onStoreChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
    mq?.removeEventListener?.("change", onStoreChange);
  };
}

/**
 * Minimal inline script for the root layout's `next/script` (`beforeInteractive`)
 * so the saved palette + resolved mode apply before first paint. Honors a saved choice,
 * otherwise the seeded defaults. Resolves "system" against the OS scheme. Keys and
 * defaults stay in sync with the exports above.
 */
export function getThemeBootstrapInlineScript(): string {
  const modeKey = JSON.stringify(THEME_MODE_KEY);
  const presetKey = JSON.stringify(THEME_PRESET_KEY);
  const defaultPreset = JSON.stringify(DEFAULT_THEME_PRESET_ID);
  const defaultMode = JSON.stringify(DEFAULT_THEME_MODE_SETTING);
  return `(function(){try{var m=${modeKey};var p=${presetKey};var setting=localStorage.getItem(m)||${defaultMode};if(setting!=="dark"&&setting!=="light"&&setting!=="system"){setting=${defaultMode};}var resolved=setting;if(setting==="system"){resolved=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";}var preset=localStorage.getItem(p)||${defaultPreset};var root=document.documentElement;root.setAttribute("data-theme",resolved);root.setAttribute("data-theme-mode",setting);root.setAttribute("data-theme-preset",preset);}catch(e){document.documentElement.setAttribute("data-theme","dark");document.documentElement.setAttribute("data-theme-mode",${defaultMode});document.documentElement.setAttribute("data-theme-preset",${defaultPreset});}})();`;
}

export interface ThemeSelection {
  /** The user's mode setting (may be "system"). */
  mode: ThemeModeSetting;
  /** The concrete applied mode after resolving "system". */
  resolvedMode: ThemeMode;
  preset: ThemePresetId;
}

const SERVER_THEME_SELECTION: ThemeSelection = {
  mode: DEFAULT_THEME_MODE_SETTING,
  resolvedMode: resolveMode(DEFAULT_THEME_MODE_SETTING),
  preset: DEFAULT_THEME_PRESET_ID,
};
let cachedThemeSelection: ThemeSelection = SERVER_THEME_SELECTION;

export function getThemeSelectionFromDom(): ThemeSelection {
  if (typeof document === "undefined") return SERVER_THEME_SELECTION;
  const root = document.documentElement;
  const mode = sanitizeModeSetting(root.getAttribute("data-theme-mode"));
  const resolvedMode = mode === "system" ? resolveMode("system") : mode;
  const preset = sanitizePreset(root.getAttribute("data-theme-preset"));
  if (
    cachedThemeSelection.mode === mode &&
    cachedThemeSelection.resolvedMode === resolvedMode &&
    cachedThemeSelection.preset === preset
  ) {
    return cachedThemeSelection;
  }
  cachedThemeSelection = { mode, resolvedMode, preset };
  return cachedThemeSelection;
}

export function getServerThemeSelectionSnapshot(): ThemeSelection {
  return SERVER_THEME_SELECTION;
}

let themeTransitionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Briefly enable palette cross-fade transitions (see `.theme-transition` in globals.css)
 * around a theme change, then remove the class so it never affects normal interactions.
 */
function flashThemeTransition(root: HTMLElement): void {
  root.classList.add("theme-transition");
  if (themeTransitionTimer) clearTimeout(themeTransitionTimer);
  themeTransitionTimer = setTimeout(() => {
    root.classList.remove("theme-transition");
    themeTransitionTimer = null;
  }, 320);
}

export function applyThemeSelection(
  selection: { mode: ThemeModeSetting; preset: ThemePresetId },
  options?: { persist?: boolean; notify?: boolean },
): void {
  if (typeof document === "undefined") return;
  const { mode, preset } = selection;
  const resolvedMode = resolveMode(mode);
  const persist = options?.persist !== false;
  const notify = options?.notify !== false;
  const root = document.documentElement;
  flashThemeTransition(root);
  root.setAttribute("data-theme", resolvedMode);
  root.setAttribute("data-theme-mode", mode);
  root.setAttribute("data-theme-preset", preset);
  if (persist) {
    try {
      localStorage.setItem(THEME_MODE_KEY, mode);
      localStorage.setItem(THEME_PRESET_KEY, preset);
    } catch {
      // no-op if storage is unavailable
    }
  }
  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_EVENT));
  }
}
