"use client";

import { useMemo, useSyncExternalStore } from "react";
import { getThemePresets, getThemeNow, THEME_CALENDAR_EVENT, THEME_PRESETS } from "@/lib/themes/presets";
import { getRuntimeThemes, getManagedThemePlugins, RUNTIME_THEMES_EVENT } from "@/lib/plugins/runtime-theme-client";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_CALENDAR_EVENT, onChange);
  window.addEventListener(RUNTIME_THEMES_EVENT, onChange);
  return () => { window.removeEventListener(THEME_CALENDAR_EVENT, onChange); window.removeEventListener(RUNTIME_THEMES_EVENT, onChange); };
}

function calendarDay(): string {
  return getThemeNow().toDateString() + getRuntimeThemes().map(theme => theme.revision).join(":") + getManagedThemePlugins().join(":");
}

export function useAvailableThemePresets() {
  const day = useSyncExternalStore(subscribe, calendarDay, () => "");
  return useMemo(() => {
    // Seasonal scheduling controls automatic selection, not the manual picker.
    return day ? getThemePresets() : THEME_PRESETS;
  }, [day]);
}
