export type ThemeMode = "dark" | "light";

export const THEME_MODE_KEY = "devhub:theme";
export const THEME_PRESET_KEY = "devhub:theme-preset";
export const THEME_EVENT = "devhub:theme-change";

export const THEME_PRESETS = [
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

export type ThemePresetId = (typeof THEME_PRESETS)[number]["id"];
export type ThemePresetMeta = (typeof THEME_PRESETS)[number];

/** Default palette — matches `data-theme-preset` on `<html>` and the inline bootstrap script. */
export const DEFAULT_THEME_PRESET_ID: ThemePresetId = "graphite";

const VALID_PRESET_IDS = new Set<ThemePresetId>(THEME_PRESETS.map((p) => p.id));

export function sanitizeMode(value: string | null | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}

export function sanitizePreset(value: string | null | undefined): ThemePresetId {
  if (value && VALID_PRESET_IDS.has(value as ThemePresetId)) {
    return value as ThemePresetId;
  }
  return DEFAULT_THEME_PRESET_ID;
}

/** `useSyncExternalStore` subscription — theme changes and cross-tab `storage` updates. */
export function subscribeThemeSelection(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/**
 * Minimal inline script for the root layout’s `next/script` (`beforeInteractive`)
 * so the saved palette applies before first paint.
 * Honors a saved choice, otherwise defaults to dark (matching `<html data-theme>`).
 * Keys and default preset stay in sync with `THEME_MODE_KEY` / `THEME_PRESET_KEY` / `DEFAULT_THEME_PRESET_ID`.
 */
export function getThemeBootstrapInlineScript(): string {
  const modeKey = JSON.stringify(THEME_MODE_KEY);
  const presetKey = JSON.stringify(THEME_PRESET_KEY);
  const defaultPreset = JSON.stringify(DEFAULT_THEME_PRESET_ID);
  return `(function(){try{var m=${modeKey};var p=${presetKey};var theme=localStorage.getItem(m)||"dark";var preset=localStorage.getItem(p)||${defaultPreset};document.documentElement.setAttribute("data-theme",theme);document.documentElement.setAttribute("data-theme-preset",preset);}catch(e){document.documentElement.setAttribute("data-theme","dark");document.documentElement.setAttribute("data-theme-preset",${defaultPreset});}})();`;
}

const SERVER_THEME_SELECTION: { mode: ThemeMode; preset: ThemePresetId } = {
  mode: "dark",
  preset: DEFAULT_THEME_PRESET_ID,
};
let cachedThemeSelection: { mode: ThemeMode; preset: ThemePresetId } = SERVER_THEME_SELECTION;

export function getThemeSelectionFromDom(): { mode: ThemeMode; preset: ThemePresetId } {
  if (typeof document === "undefined") return SERVER_THEME_SELECTION;
  const root = document.documentElement;
  const mode = sanitizeMode(root.getAttribute("data-theme"));
  const preset = sanitizePreset(root.getAttribute("data-theme-preset"));
  if (cachedThemeSelection.mode === mode && cachedThemeSelection.preset === preset) {
    return cachedThemeSelection;
  }
  cachedThemeSelection = { mode, preset };
  return cachedThemeSelection;
}

export function getServerThemeSelectionSnapshot(): { mode: ThemeMode; preset: ThemePresetId } {
  return SERVER_THEME_SELECTION;
}

export function applyThemeSelection(
  selection: { mode: ThemeMode; preset: ThemePresetId },
  options?: { persist?: boolean; notify?: boolean },
): void {
  if (typeof document === "undefined") return;
  const { mode, preset } = selection;
  const persist = options?.persist !== false;
  const notify = options?.notify !== false;
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
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
