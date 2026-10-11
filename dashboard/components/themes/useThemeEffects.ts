"use client";

import { useSyncExternalStore } from "react";
import { THEME_EFFECTS, parseThemeEffects, themeEffectDefaults, type ThemeEffectPreferences } from "@/lib/theme-effects";
import { getHollowEffectsSnapshot, updateHollowEffects } from "@/components/hollow/useHollowEffects";
import { getGraphiteEffectsSnapshot, updateGraphiteEffects } from "@/components/graphite/useGraphiteEffects";

const cache = new Map<string, { raw: string | null; preferences: ThemeEffectPreferences }>();
const server = new Map<string, ThemeEffectPreferences>();

function snapshot(preset: string): ThemeEffectPreferences {
  const previous = cache.get(preset);
  let raw: string | null = null;
  try { raw = preset === "hollow" ? JSON.stringify(getHollowEffectsSnapshot()) : preset === "graphite" ? JSON.stringify(getGraphiteEffectsSnapshot()) : localStorage.getItem(THEME_EFFECTS[preset]?.storageKey ?? ""); }
  catch { if (previous) return previous.preferences; }
  if (previous && previous.raw === raw) return previous.preferences;
  const preferences = parseThemeEffects(preset, raw);
  cache.set(preset, { raw, preferences });
  return preferences;
}

function subscribe(preset: string, onChange: () => void) {
  const eventName = THEME_EFFECTS[preset]?.event ?? "devhub:theme-effects";
  const stored = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_EFFECTS[preset]?.storageKey) onChange();
  };
  window.addEventListener(eventName, onChange);
  window.addEventListener("storage", stored);
  return () => { window.removeEventListener(eventName, onChange); window.removeEventListener("storage", stored); };
}

export function useThemeEffects(preset: string): ThemeEffectPreferences {
  if (!server.has(preset)) server.set(preset, themeEffectDefaults(preset));
  return useSyncExternalStore(callback => subscribe(preset, callback), () => snapshot(preset), () => server.get(preset)!);
}

export function updateThemeEffects(preset: string, patch: ThemeEffectPreferences): void {
  const declaration = THEME_EFFECTS[preset];
  if (!declaration) return;
  if (preset === "hollow") { updateHollowEffects(patch); return; }
  if (preset === "graphite") { updateGraphiteEffects(patch); return; }
  const preferences = { ...snapshot(preset), ...patch };
  const raw = JSON.stringify(preferences);
  const previousRaw = cache.get(preset)?.raw ?? null;
  cache.set(preset, { raw, preferences });
  try { localStorage.setItem(declaration.storageKey, raw); }
  catch { cache.set(preset, { raw: previousRaw, preferences }); }
  window.dispatchEvent(new Event(declaration.event));
}
