"use client";

import { useSyncExternalStore } from "react";

/**
 * Single source of truth for the mobile breakpoint. Mirrors Tailwind's
 * `md` breakpoint and the `@media (max-width: 767px)` blocks in
 * globals.css — keep all three in sync if the breakpoint ever changes.
 */
export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

/**
 * One-shot, SSR-safe check. Use in event handlers / callbacks where a
 * reactive value isn't needed (e.g. "navigate instead of open a panel").
 */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Reactive viewport check. Re-renders when crossing the mobile
 * breakpoint. SSR/first paint returns `false` (desktop-first) to match
 * the server render and avoid hydration mismatches.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false);
}
