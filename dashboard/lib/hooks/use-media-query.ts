"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Reactive `window.matchMedia` result.
 *
 * SSR / first paint returns `false` so the server render and the hydrated render
 * agree — callers should be written desktop-first and narrow from there.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => matchesMediaQuery(query), [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** One-shot, SSR-safe check for event handlers where a reactive value isn't needed. */
export function matchesMediaQuery(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}
