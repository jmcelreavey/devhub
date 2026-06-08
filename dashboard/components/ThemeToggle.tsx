"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import {
  applyThemeSelection,
  getThemeSelectionFromDom,
  getServerThemeSelectionSnapshot,
  subscribeThemeSelection,
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
export function ThemeToggle() {
  const theme = useTheme();
  const isDark = theme.mode === "dark";

  const toggle = useCallback(() => {
    applyThemeSelection({ mode: isDark ? "light" : "dark", preset: theme.preset });
  }, [isDark, theme.preset]);

  return (
    <button
      type="button"
      className="hub-icon-btn"
      onClick={toggle}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
    </button>
  );
}
