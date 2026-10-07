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

/**
 * What `NavItem.desktopOnly` means: a real mouse, not a touch screen. Not the
 * Tauri shell — a browser tab on the checkout gets Repos and Logs too.
 */
export const DESKTOP_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/** SSR assumes desktop so the sidebar doesn't render short and then grow. */
export function useIsDesktopPointer(): boolean {
  return useMediaQuery(DESKTOP_POINTER_QUERY, true);
}
