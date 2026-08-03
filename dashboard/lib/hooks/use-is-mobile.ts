"use client";

import { matchesMediaQuery, useMediaQuery } from "@/lib/hooks/use-media-query";

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
  return matchesMediaQuery(MOBILE_MEDIA_QUERY);
}

/**
 * Reactive viewport check. Re-renders when crossing the mobile
 * breakpoint. SSR/first paint returns `false` (desktop-first) to match
 * the server render and avoid hydration mismatches.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
