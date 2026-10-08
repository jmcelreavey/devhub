"use client";

import { useEffect } from "react";
import {
  THEME_MODE_KEY,
  applyThemeSelection,
  sanitizeModeSetting,
  sanitizePreset,
  syncSeasonalTheme,
} from "@/lib/theme-presets";

/**
 * Keeps the applied `data-theme` attribute in sync with the OS colour scheme while the
 * user is on the "system" setting, so the palette flips live when the OS does. No-op when
 * the user has pinned dark or light. Re-applies without persisting (the setting stays
 * "system"). The initial value is set by the inline bootstrap script in `layout.tsx`.
 */
export function ThemeSystemSync() {
  useEffect(() => {
    let midnight = 0;
    function sync() {
      syncSeasonalTheme();
      window.clearTimeout(midnight);
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnight = window.setTimeout(sync, next.getTime() - now.getTime() + 50);
    }
    function resumed() { if (!document.hidden) sync(); }
    function stored(event: StorageEvent) {
      if (event.key === null || ["devhub:theme", "devhub:theme-preset", "devhub:hollow-season"].includes(event.key)) sync();
    }
    sync();
    document.addEventListener("visibilitychange", resumed);
    window.addEventListener("focus", sync);
    window.addEventListener("storage", stored);
    return () => {
      window.clearTimeout(midnight);
      document.removeEventListener("visibilitychange", resumed);
      window.removeEventListener("focus", sync);
      window.removeEventListener("storage", stored);
    };
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const setting = sanitizeModeSetting(localStorage.getItem(THEME_MODE_KEY));
      if (setting !== "system") return;
      const preset = sanitizePreset(document.documentElement.getAttribute("data-theme-preset"));
      applyThemeSelection({ mode: "system", preset }, { persist: false });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}
