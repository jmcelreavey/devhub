"use client";

import { useSyncExternalStore } from "react";
import {
  HOLLOW_EFFECTS_EVENT,
  HOLLOW_EFFECT_DEFAULTS,
  type HollowEffects,
  hollowMotionAllowed,
  readHollowEffects,
  writeHollowEffects,
} from "@/lib/hollow-theme";
import { startHollowSound, stopHollowSound } from "@/components/hollow/hollow-audio";

let cached: HollowEffects = HOLLOW_EFFECT_DEFAULTS;
let cachedKey = "";
const subscribers = new Set<() => void>();

export function getHollowEffectsSnapshot(): HollowEffects {
  if (typeof window === "undefined") return HOLLOW_EFFECT_DEFAULTS;
  let next: HollowEffects;
  try { next = readHollowEffects(localStorage); }
  catch { return cached; }
  const key = JSON.stringify(next);
  if (key === cachedKey) return cached;
  cached = next;
  cachedKey = key;
  return cached;
}

function subscribeEffects(onChange: () => void): () => void {
  subscribers.add(onChange);
  window.addEventListener(HOLLOW_EFFECTS_EVENT, onChange);
  const stored = (event: StorageEvent) => { if (event.key === null || event.key === "devhub:hollow-effects") onChange(); };
  window.addEventListener("storage", stored);
  return () => { subscribers.delete(onChange); window.removeEventListener(HOLLOW_EFFECTS_EVENT, onChange); window.removeEventListener("storage", stored); };
}

export function refreshHollowEffects(): void {
  for (const subscriber of subscribers) subscriber();
}

export function useHollowEffects(): HollowEffects {
  return useSyncExternalStore(subscribeEffects, getHollowEffectsSnapshot, () => HOLLOW_EFFECT_DEFAULTS);
}

export function updateHollowEffects(patch: Partial<HollowEffects>): HollowEffects {
  const next = { ...getHollowEffectsSnapshot(), ...patch };
  try { writeHollowEffects(localStorage, next); cachedKey = JSON.stringify(next); }
  catch { cached = next; }
  cached = next;
  refreshHollowEffects();
  window.dispatchEvent(new Event(HOLLOW_EFFECTS_EVENT));
  if (next.master && next.sound && (patch.sound === true || patch.master === true)) {
    startHollowSound();
  }
  if (!next.master || !next.sound) stopHollowSound();
  return next;
}

function motionSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const killed = document.body?.getAttribute("data-motion") === "off";
  return hollowMotionAllowed(reduced, killed);
}

function subscribeMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener?.("change", onChange);
  const obs = new MutationObserver(onChange);
  if (document.body) {
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-motion"] });
  }
  return () => {
    mq.removeEventListener?.("change", onChange);
    obs.disconnect();
  };
}

export function useHollowMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, () => true);
}
