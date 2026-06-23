"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  applyThemeSelection,
  getThemeSelectionFromDom,
  getServerThemeSelectionSnapshot,
  subscribeThemeSelection,
  type ThemeModeSetting,
} from "@/lib/theme-presets";

/** Reactive accessor for the current theme — re-renders on system or local change. */
export function useTheme() {
  return useSyncExternalStore(
    subscribeThemeSelection,
    getThemeSelectionFromDom,
    getServerThemeSelectionSnapshot,
  );
}

/**
 * Top-bar button that flips between light and dark for the currently selected
 * preset palette.
 * The initial theme is set by the inline script in `app/layout.tsx` to avoid a
 * flash of the wrong palette on first paint.
 */
/** Cycle order: follow the OS, then pin dark, then pin light, then back to OS. */
const MODE_CYCLE: ThemeModeSetting[] = ["system", "dark", "light"];
const MODE_LABEL: Record<ThemeModeSetting, string> = {
  system: "Match system theme",
  dark: "Dark theme",
  light: "Light theme",
};

export function ThemeToggle() {
  const theme = useTheme();
  const setting = theme.mode;

  const cycle = useCallback(() => {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(setting) + 1) % MODE_CYCLE.length];
    applyThemeSelection({ mode: next, preset: theme.preset });
  }, [setting, theme.preset]);

  // Icon reflects the current setting: a monitor for "system", else the resolved mode.
  const Icon = setting === "system" ? Monitor : theme.resolvedMode === "dark" ? Moon : Sun;
  const label = `${MODE_LABEL[setting]} (click to change)`;

  return (
    <button
      type="button"
      className="hub-icon-btn"
      onClick={cycle}
      title={label}
      aria-label={label}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}
