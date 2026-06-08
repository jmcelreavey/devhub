"use client";

import { useCallback, useSyncExternalStore } from "react";

export const SHELF_PREFIX = "mobile-shelf-collapsed:";
export const SHELF_EVENT = "devhub:mobile-shelf";

function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "true";
}

function writeBool(key: string, value: boolean) {
  window.localStorage.setItem(key, String(value));
  window.dispatchEvent(new CustomEvent(SHELF_EVENT, { detail: key }));
}

function subscribe(cb: () => void) {
  window.addEventListener(SHELF_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(SHELF_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Per-route shelf collapse state persisted in localStorage. */
export function useMobileShelf(route: string): { collapsed: boolean; toggle: () => void; collapse: () => void; expand: () => void } {
  const key = SHELF_PREFIX + route;
  const collapsed = useSyncExternalStore(subscribe, () => readBool(key), () => false);
  const toggle   = useCallback(() => writeBool(key, !readBool(key)), [key]);
  const collapse = useCallback(() => writeBool(key, true),  [key]);
  const expand   = useCallback(() => writeBool(key, false), [key]);
  return { collapsed, toggle, collapse, expand };
}
