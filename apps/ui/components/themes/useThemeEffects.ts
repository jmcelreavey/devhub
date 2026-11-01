"use client";

import { useSyncExternalStore } from "react";
import { getThemeEffects, parseThemeEffects, themeEffectDefaults, type ThemeEffectPreferences } from "@/lib/theme-effects";
import { RUNTIME_THEMES_EVENT } from "@/lib/plugins/runtime-theme-client";
import { getGraphiteEffectsSnapshot, updateGraphiteEffects } from "@/components/graphite/useGraphiteEffects";

const cache = new Map<string, { raw: string | null; definition: string; preferences: ThemeEffectPreferences }>();
const server = new Map<string, ThemeEffectPreferences>();
const lifecycleHandlers = new Map<string, (next: ThemeEffectPreferences, patch: ThemeEffectPreferences) => void>();
const failedLifecycles = new Set<string>();
const lifecycleSubscribers = new Set<() => void>();

function notifyLifecycle() {
  for (const subscriber of lifecycleSubscribers) subscriber();
}

export function registerThemeLifecycle(preset: string, handler: (next: ThemeEffectPreferences, patch: ThemeEffectPreferences) => void): () => void {
  if (failedLifecycles.has(preset)) return () => {};
  if (lifecycleHandlers.has(preset)) {
    reportThemeLifecycleFailure(preset, new Error("A theme lifecycle is already registered"));
    return () => {};
  }
  lifecycleHandlers.set(preset, handler);
  notifyLifecycle();
  return () => {
    if (lifecycleHandlers.get(preset) !== handler) return;
    lifecycleHandlers.delete(preset);
    notifyLifecycle();
  };
}

export function reportThemeLifecycleFailure(preset: string, error: unknown): void {
  console.error(`Theme lifecycle failed for ${preset}`, error);
  lifecycleHandlers.delete(preset);
  failedLifecycles.add(preset);
  notifyLifecycle();
}

export function resetThemeLifecycleFailure(preset: string): void {
  if (failedLifecycles.delete(preset)) notifyLifecycle();
}

export function useThemeLifecycleReady(preset: string): boolean {
  return useSyncExternalStore(
    callback => { lifecycleSubscribers.add(callback); return () => { lifecycleSubscribers.delete(callback); }; },
    () => lifecycleHandlers.has(preset) && !failedLifecycles.has(preset),
    () => false,
  );
}

export function useThemeLifecycleFailed(preset: string): boolean {
  return useSyncExternalStore(
    callback => { lifecycleSubscribers.add(callback); return () => { lifecycleSubscribers.delete(callback); }; },
    () => failedLifecycles.has(preset),
    () => false,
  );
}

function snapshot(preset: string): ThemeEffectPreferences {
  const previous = cache.get(preset);
  const declaration = getThemeEffects()[preset];
  const definition = JSON.stringify(declaration) ?? "";
  let raw: string | null = null;
  try { raw = preset === "graphite" ? JSON.stringify(getGraphiteEffectsSnapshot()) : localStorage.getItem(declaration?.storageKey ?? ""); }
  catch { if (previous?.definition === definition) return previous.preferences; }
  if (previous && previous.raw === raw && previous.definition === definition) return previous.preferences;
  const preferences = parseThemeEffects(preset, raw);
  cache.set(preset, { raw, definition, preferences });
  return preferences;
}

function subscribe(preset: string, onChange: () => void) {
  const eventName = getThemeEffects()[preset]?.event ?? "devhub:theme-effects";
  const stored = (event: StorageEvent) => {
    if (event.key === null || event.key === getThemeEffects()[preset]?.storageKey) onChange();
  };
  window.addEventListener(eventName, onChange);
  window.addEventListener("storage", stored);
  window.addEventListener(RUNTIME_THEMES_EVENT, onChange);
  return () => { window.removeEventListener(eventName, onChange); window.removeEventListener("storage", stored); window.removeEventListener(RUNTIME_THEMES_EVENT, onChange); };
}

export function useThemeEffects(preset: string): ThemeEffectPreferences {
  if (!server.has(preset)) server.set(preset, themeEffectDefaults(preset));
  return useSyncExternalStore(callback => subscribe(preset, callback), () => snapshot(preset), () => server.get(preset)!);
}

export function updateThemeEffects(preset: string, patch: ThemeEffectPreferences): void {
  const declaration = getThemeEffects()[preset];
  if (!declaration) return;
  if (preset === "graphite") { updateGraphiteEffects(patch); return; }
  const preferences = { ...snapshot(preset), ...patch };
  const raw = JSON.stringify(preferences);
  const previousRaw = cache.get(preset)?.raw ?? null;
  const definition = JSON.stringify(declaration) ?? "";
  cache.set(preset, { raw, definition, preferences });
  try { localStorage.setItem(declaration.storageKey, raw); }
  catch { cache.set(preset, { raw: previousRaw, definition, preferences }); }
  try {
    lifecycleHandlers.get(preset)?.(preferences, patch);
  } catch (error) {
    reportThemeLifecycleFailure(preset, error);
  } finally {
    window.dispatchEvent(new Event(declaration.event));
  }
}
