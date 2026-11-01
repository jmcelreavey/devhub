import type { ThemeMode } from "./presets-types";
import { CORE_THEME_IDS } from "../../../../packages/shared/themes/core-preset-ids";
import { isThemeAvailable, type ThemeAvailability } from "../theme-availability";
import { getRuntimeThemes, runtimeThemeKey } from "../plugins/runtime-theme-client";
import type { PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";
import { getGraphiteBootstrapScript } from "../graphite-theme";
import { getThemeEffectsBootstrapScript, getThemeEffects, THEME_EFFECTS, type ThemeEffectsDeclaration } from "../theme-effects";
import {
  getHollowAttributeBootstrapScript, getHollowSeasonBootstrapScript, HOLLOW_PRESET_ID,
  HOLLOW_SEASON_KEY, overrideHollowSeason, parseHollowNow, parseHollowSeason, resolveHollowSeason,
} from "../hollow-theme";

export type { ThemeMode } from "./presets-types";

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
export const THEME_CALENDAR_EVENT = "devhub:theme-calendar-change";
export const GRAPHITE_THEME_LABEL = "Graphite Neon (Default)";
export const HOLLOW_THEME_LABEL = "Hollow (Halloween) 🎃";

/**
 * Core palettes shipped by DevHub. Plugins can append more via branding.
 *
 * These are deliberately spread across the hue wheel *and* across character —
 * temperature, chroma and contrast — because the previous set was five
 * variations on "desaturated dark neutral plus one accent", which made the
 * picker pointless. Each one now owns a lane nothing else occupies:
 *
 *   graphite    neutral achromatic charcoal + acid lime   — Shift Dock; the core default
 *   forest      warm brown-charcoal + burnt amber         — the only warm theme
 *   midnight    saturated oceanic navy + electric azure   — coldest, highest contrast
 *   tokyo       purple-black + violet/magenta neon        — neon-noir
 *   catppuccin  celadon / cream porcelain garden           — folded-leaf calm
 *
 * Swatches must match the real `--bg` in globals.css; they are what the picker
 * renders, so a drifted swatch is a picker that lies.
 */
export const CORE_THEME_PRESETS = [
  {
    id: CORE_THEME_IDS.graphite,
    effects: THEME_EFFECTS.graphite,
    label: GRAPHITE_THEME_LABEL,
    description: "DevHub's default: charcoal + lime",
    // Match Shift Dock's base and hub colours in both modes.
    darkSwatch: "#111416",
    lightSwatch: "#f7f8f9",
    darkAccent: "#9ed84a",
    lightAccent: "#4c840c",
  },
  {
    id: CORE_THEME_IDS.forest,
    effects: THEME_EFFECTS.forest,
    label: "Ember Dusk",
    description: "Warm charcoal + burnt amber",
    darkSwatch: "#14100c",
    lightSwatch: "#fbf6f0",
    darkAccent: "#ff8f3f",
    lightAccent: "#94420c",
  },
  {
    id: CORE_THEME_IDS.midnight,
    effects: THEME_EFFECTS.midnight,
    label: "Abyss",
    description: "Deep ocean navy + electric azure",
    darkSwatch: "#050a17",
    lightSwatch: "#eef4ff",
    darkAccent: "#78b9ff",
    lightAccent: "#1259d6",
  },
  {
    id: CORE_THEME_IDS.tokyo,
    effects: THEME_EFFECTS.tokyo,
    label: "Tokyo Night",
    description: "Purple-black + violet neon",
    darkSwatch: "#15121f",
    lightSwatch: "#faf6ff",
    darkAccent: "#c084fc",
    lightAccent: "#7c35d6",
  },
  {
    id: CORE_THEME_IDS.catppuccin,
    effects: THEME_EFFECTS.catppuccin,
    label: "Porcelain Garden",
    description: "Celadon + cream, folded-leaf calm",
    darkSwatch: "#101b19",
    lightSwatch: "#f7f6f0",
    darkAccent: "#96d6bd",
    lightAccent: "#216b53",
  },
] as const;

export type ThemePresetMeta = {
  id: string;
  label: string;
  description: string;
  darkSwatch: string;
  lightSwatch: string;
  /**
   * The accent each mode uses. Optional because plugin-contributed presets
   * predate these fields; the picker falls back to a plain background chip.
   *
   * Worth having because every dark `--bg` is a near-black rectangle — showing
   * only the background made all six swatches look identical, which is the
   * exact complaint the palettes themselves were redesigned to fix.
   */
  effects?: ThemeEffectsDeclaration;
  darkAccent?: string;
  lightAccent?: string;
  availability?: ThemeAvailability;
};

/**
 * The preset list the UI renders: core palettes plus any plugin-contributed ones.
 * Core wins on id collisions, and plugin presets are appended in declaration order.
 */
export const THEME_PRESETS: ThemePresetMeta[] = [...CORE_THEME_PRESETS];

export type ThemePresetId = string;

export function getThemePresets(runtime: PublicRuntimeTheme[] = getRuntimeThemes()): ThemePresetMeta[] {
  const ids = new Set(runtime.map(theme => theme.id));
  return [...THEME_PRESETS.filter(theme => !ids.has(theme.id)), ...runtime.map(theme => ({
    id: theme.id, label: theme.label, description: theme.description, availability: theme.availability,
    darkSwatch: theme.dark.bg, lightSwatch: theme.light.bg, darkAccent: theme.dark.accent, lightAccent: theme.light.accent,
    effects: getThemeEffects(runtime)[theme.id],
  }))];
}

function validPresetIds(): Set<string> { return new Set(getThemePresets().map(theme => theme.id)); }

/**
 * Core fallback default. The active default is `DEFAULT_THEME_PRESET_ID` below, which a
 * branding plugin can override.
 */
export const CORE_DEFAULT_THEME_PRESET_ID = "graphite";

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = CORE_DEFAULT_THEME_PRESET_ID;
export const DEFAULT_THEME_MODE_SETTING: ThemeModeSetting = "system";

export function sanitizeMode(value: string | null | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}

/** Coerce an arbitrary stored value into a valid mode *setting*. */
export function sanitizeModeSetting(value: string | null | undefined): ThemeModeSetting {
  if (value === "light" || value === "dark" || value === "system") return value;
  return DEFAULT_THEME_MODE_SETTING;
}

export function getThemeNow(): Date {
  const now = new Date();
  return typeof window === "undefined" ? now : parseHollowNow(window.location.search, now);
}

export function getAvailableThemePresets(date = getThemeNow(), presets = getThemePresets()): ThemePresetMeta[] {
  return presets.filter(preset => isThemeAvailable(preset.availability, date));
}

export function sanitizePreset(value: string | null | undefined, date = getThemeNow()): ThemePresetId {
  if (value && validPresetIds().has(value)) return value;
  if (value && /^[a-z][a-z0-9-]{0,63}$/.test(value)) return CORE_DEFAULT_THEME_PRESET_ID;
  const preset = getThemePresets().find(candidate => candidate.id === DEFAULT_THEME_PRESET_ID);
  return preset && isThemeAvailable(preset.availability, date) ? DEFAULT_THEME_PRESET_ID : CORE_DEFAULT_THEME_PRESET_ID;
}

function storedPreset(value: string | null, presets: readonly string[], fallback: string): string {
  return value && (presets.includes(value) || /^[a-z][a-z0-9-]{0,63}$/.test(value)) ? value : fallback;
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
 * Minimal inline script inserted into the Vite HTML head
 * so the saved palette + resolved mode apply before first paint. Honors a saved choice,
 * otherwise the seeded defaults. Resolves "system" against the OS scheme. Keys and
 * defaults stay in sync with the exports above.
 */
export function getThemeBootstrapInlineScript(presets: ThemePresetMeta[] = THEME_PRESETS, effects = THEME_EFFECTS): string {
  const validIds = presets.map(preset => preset.id);
  const selectedDefault = validIds.includes(DEFAULT_THEME_PRESET_ID) ? DEFAULT_THEME_PRESET_ID : CORE_DEFAULT_THEME_PRESET_ID;
  const modeKey = JSON.stringify(THEME_MODE_KEY);
  const presetKey = JSON.stringify(THEME_PRESET_KEY);
  const defaultPreset = JSON.stringify(selectedDefault);
  const defaultMode = JSON.stringify(DEFAULT_THEME_MODE_SETTING);
  const availability = JSON.stringify(presets.filter(preset => preset.availability).map(preset => [preset.id, preset.availability]));
  const defaultOnStorageFailure = presets.find(preset => preset.id === selectedDefault)?.availability
    ? JSON.stringify(CORE_DEFAULT_THEME_PRESET_ID) : defaultPreset;
  return `(function(){try{var m=${modeKey};var p=${presetKey};var setting=localStorage.getItem(m)||${defaultMode};if(setting!=="dark"&&setting!=="light"&&setting!=="system"){setting=${defaultMode};}var presets=${JSON.stringify(validIds)};var windows=${availability};var defaultWindow=windows.find(function(entry){return entry[0]===${defaultPreset};});var now=(${parseHollowNow.toString()})(window.location.search,new Date());var defaultAvailable=(${isThemeAvailable.toString()})(defaultWindow&&defaultWindow[1],now);var preset=(${storedPreset.toString()})(localStorage.getItem(p),presets,defaultAvailable?${defaultPreset}:${JSON.stringify(CORE_DEFAULT_THEME_PRESET_ID)});${getHollowSeasonBootstrapScript(validIds)}var resolved=setting;if(setting==="system"){resolved=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";}var root=document.documentElement;root.setAttribute("data-theme",resolved);root.setAttribute("data-theme-mode",setting);root.setAttribute("data-theme-preset",presets.includes(preset)?preset:${JSON.stringify(CORE_DEFAULT_THEME_PRESET_ID)});}catch(e){document.documentElement.setAttribute("data-theme","dark");document.documentElement.setAttribute("data-theme-mode",${defaultMode});document.documentElement.setAttribute("data-theme-preset",${defaultOnStorageFailure});}})();${getHollowAttributeBootstrapScript()}${getGraphiteBootstrapScript()}${getThemeEffectsBootstrapScript(effects)}`;
}

/** Reconcile a tab left open across midnight, resumed, or changed in another tab. */
export function syncSeasonalTheme(): void {
  const now = getThemeNow();
  const validIds = validPresetIds();
  try {
    const savedPreset = localStorage.getItem(THEME_PRESET_KEY);
    const current = {
      preset: storedPreset(savedPreset, [...validIds], sanitizePreset(null, now)),
      mode: sanitizeModeSetting(localStorage.getItem(THEME_MODE_KEY)),
    };
    const result = resolveHollowSeason(
      now, current,
      parseHollowSeason(localStorage.getItem(HOLLOW_SEASON_KEY), [...validIds]),
      validIds.has(HOLLOW_PRESET_ID),
      savedPreset !== null,
    );
    if (result.state) localStorage.setItem(HOLLOW_SEASON_KEY, JSON.stringify(result.state));
    localStorage.setItem(THEME_PRESET_KEY, result.selection.preset);
    localStorage.setItem(THEME_MODE_KEY, result.selection.mode);
    const active = getThemeSelectionFromDom();
    const selection = { ...result.selection, preset: sanitizePreset(result.selection.preset, now) };
    if (document.documentElement.getAttribute("data-theme-preset") !== selection.preset || active.mode !== selection.mode) {
      applyThemeSelection(selection, { persist: false });
    }
  } catch {
    const root = document.documentElement;
    const preset = sanitizePreset(root.getAttribute("data-theme-preset"), now);
    if (preset !== root.getAttribute("data-theme-preset")) {
      applyThemeSelection({ mode: sanitizeModeSetting(root.getAttribute("data-theme-mode")), preset }, { persist: false });
    }
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(THEME_CALENDAR_EVENT));
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
  preset: sanitizePreset(null),
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
  options?: { persist?: boolean; notify?: boolean; preserveUnavailablePreset?: boolean },
): void {
  if (typeof document === "undefined") return;
  const { mode } = selection;
  const preset = sanitizePreset(selection.preset);
  const resolvedMode = resolveMode(mode);
  const persist = options?.persist !== false;
  const notify = options?.notify !== false;
  const root = document.documentElement;
  const presetChanged = root.getAttribute("data-theme-preset") !== preset;
  flashThemeTransition(root);
  root.setAttribute("data-theme", resolvedMode);
  root.setAttribute("data-theme-mode", mode);
  root.setAttribute("data-theme-preset", preset);
  const runtime = getRuntimeThemes().find(theme => theme.id === preset);
  if (runtime) root.setAttribute("data-runtime-theme", runtimeThemeKey(runtime));
  else root.removeAttribute("data-runtime-theme");
  if (persist) {
    try {
      const validIds = validPresetIds();
      const savedSeason = parseHollowSeason(localStorage.getItem(HOLLOW_SEASON_KEY), [...validIds]);
      const seasonal = presetChanged
        ? overrideHollowSeason(parseHollowNow(window.location.search, new Date()), savedSeason)
        : savedSeason;
      if (seasonal) localStorage.setItem(HOLLOW_SEASON_KEY, JSON.stringify(seasonal));
      localStorage.setItem(THEME_MODE_KEY, mode);
      const savedPreset = localStorage.getItem(THEME_PRESET_KEY);
      const preservePreset = options?.preserveUnavailablePreset && savedPreset
        && !validIds.has(savedPreset)
        && storedPreset(savedPreset, [...validIds], DEFAULT_THEME_PRESET_ID) === savedPreset;
      if (!preservePreset) localStorage.setItem(THEME_PRESET_KEY, preset);
    } catch {
      // no-op if storage is unavailable
    }
  }
  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_EVENT));
  }
}
