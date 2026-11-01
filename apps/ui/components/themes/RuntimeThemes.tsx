"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyThemeSelection, resolveMode, sanitizeModeSetting, sanitizePreset, THEME_CALENDAR_EVENT, THEME_MODE_KEY, THEME_PRESET_KEY } from "@/lib/themes/presets";
import { getRuntimeThemes, getManagedThemePlugins, replaceRuntimeThemes, runtimeThemeCss, runtimeThemeKey, subscribeRuntimeThemes } from "@/lib/plugins/runtime-theme-client";
import { runtimeThemeCatalogSchema, type PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";
import { subscribeToTaskEvents } from "@/lib/events/task-subscription";

const empty: PublicRuntimeTheme[] = [];
export function useRuntimeThemes() { return useSyncExternalStore(subscribeRuntimeThemes, getRuntimeThemes, () => empty); }

/** Refreshing changes metadata and assets, without loading plugin code into React. */
export function RuntimeThemes() {
  const themes = useRuntimeThemes();
  useEffect(() => {
    let active = true;
    let request: AbortController | undefined;
    function reconcile() {
      let preset = document.documentElement.getAttribute("data-theme-preset") ?? "graphite";
      let mode = sanitizeModeSetting(document.documentElement.getAttribute("data-theme-mode"));
      try { preset = localStorage.getItem(THEME_PRESET_KEY) ?? preset; mode = sanitizeModeSetting(localStorage.getItem(THEME_MODE_KEY)); } catch { /* Keep the current selection when storage is unavailable. */ }
      const root = document.documentElement;
      const desired = sanitizePreset(preset);
      const runtime = getRuntimeThemes().find(theme => theme.id === desired);
      if (root.dataset.themePreset !== desired || root.dataset.themeMode !== mode || root.dataset.theme !== resolveMode(mode) || root.dataset.runtimeTheme !== (runtime ? runtimeThemeKey(runtime) : undefined)) {
        applyThemeSelection({ preset, mode }, { persist: false });
      }
      window.dispatchEvent(new Event(THEME_CALENDAR_EVENT));
    }
    async function refresh() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch("/api/plugins/themes", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Theme catalogue unavailable");
        const body = await response.text();
        if (body.length > 2 * 1024 * 1024) throw new Error("Theme catalogue is too large");
        const next = runtimeThemeCatalogSchema.parse(JSON.parse(body));
        if (!active || request !== controller) return;
        replaceRuntimeThemes(next.themes, next.managedPlugins);
        reconcile();
      } catch {
        if (!active || request !== controller) return;
        replaceRuntimeThemes([], getManagedThemePlugins());
        reconcile();
      } finally { window.clearTimeout(timeout); }
    }
    void refresh();
    const unsubscribe = subscribeToTaskEvents({ plugins: true, domains: ["plugins"], connection: () => {}, refresh: () => { void refresh(); } });
    return () => { active = false; request?.abort(); unsubscribe(); };
  }, []);
  return <style data-runtime-theme-palettes>{runtimeThemeCss(themes)}</style>;
}
