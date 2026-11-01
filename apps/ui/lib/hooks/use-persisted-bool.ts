"use client";

import { useCallback, useSyncExternalStore } from "react";

function readBool(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  return stored === "true";
}

function writeBool(key: string, value: boolean, eventName: string) {
  localStorage.setItem(key, String(value));
  window.dispatchEvent(new Event(eventName));
}

export function createPersistedBoolStore(eventName: string) {
  function subscribe(cb: () => void) {
    window.addEventListener(eventName, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(eventName, cb);
      window.removeEventListener("storage", cb);
    };
  }

  function usePersistedBool(
    key: string,
    defaultValue = false,
  ): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
    const value = useSyncExternalStore(
      subscribe,
      () => readBool(key, defaultValue),
      () => defaultValue,
    );
    const set = useCallback(
      (next: boolean | ((prev: boolean) => boolean)) => {
        const resolved =
          typeof next === "function" ? next(readBool(key, defaultValue)) : next;
        writeBool(key, resolved, eventName);
      },
      [key, defaultValue],
    );
    return [value, set];
  }

  return usePersistedBool;
}
