"use client";

import { useSyncExternalStore } from "react";
import { GRAPHITE_EFFECT_DEFAULTS, GRAPHITE_EFFECTS_EVENT, GRAPHITE_EFFECTS_KEY,
  parseGraphiteEffects, type GraphiteEffects } from "@/lib/graphite-theme";

let cached: GraphiteEffects = GRAPHITE_EFFECT_DEFAULTS;
let rawCache: string | null | undefined;

export function getGraphiteEffectsSnapshot(): GraphiteEffects {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(GRAPHITE_EFFECTS_KEY); }
  catch { return cached; } // Keep session preferences when storage is unavailable.
  if (raw !== rawCache) {
    rawCache = raw;
    cached = parseGraphiteEffects(raw);
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  const stored = (event: StorageEvent) => {
    if (event.key === null || event.key === GRAPHITE_EFFECTS_KEY) onChange();
  };
  window.addEventListener(GRAPHITE_EFFECTS_EVENT, onChange);
  window.addEventListener("storage", stored);
  return () => {
    window.removeEventListener(GRAPHITE_EFFECTS_EVENT, onChange);
    window.removeEventListener("storage", stored);
  };
}

export function useGraphiteEffects(): GraphiteEffects {
  return useSyncExternalStore(subscribe, getGraphiteEffectsSnapshot, () => GRAPHITE_EFFECT_DEFAULTS);
}

export function updateGraphiteEffects(patch: Partial<GraphiteEffects>): void {
  cached = { ...getGraphiteEffectsSnapshot(), ...patch };
  try {
    const raw = JSON.stringify(cached);
    window.localStorage.setItem(GRAPHITE_EFFECTS_KEY, raw);
    rawCache = raw;
  } catch { /* The controls still work for this session. */ }
  window.dispatchEvent(new Event(GRAPHITE_EFFECTS_EVENT));
}

function motionSnapshot(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    && document.body.getAttribute("data-motion") !== "off" && !document.hidden;
}

function subscribeMotion(onChange: () => void): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ["data-motion"] });
  query.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onChange);
    observer.disconnect();
  };
}

export function useGraphiteMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
}
