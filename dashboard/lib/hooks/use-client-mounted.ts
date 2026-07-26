"use client";

import { useSyncExternalStore } from "react";

/**
 * False on the server and during hydration; true after the client has committed.
 * Use to gate browser-only UI (localStorage, live counts, Date.now()) and avoid
 * React hydration mismatches.
 */
export function useClientMounted(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => {};
      const id = window.requestAnimationFrame(() => onStoreChange());
      return () => window.cancelAnimationFrame(id);
    },
    () => true,
    () => false,
  );
}
