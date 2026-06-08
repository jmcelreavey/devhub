"use client";

import { useEffect, useSyncExternalStore } from "react";

export const READ_STATUS_KEYS = {
  dashboardTickets: "dashboard:tickets",
  dashboardPrs: "dashboard:prs",
} as const;

export type ReadStatusKey = (typeof READ_STATUS_KEYS)[keyof typeof READ_STATUS_KEYS];

const READ_STATUS_EVENT = "devhub:read-status";
const STORAGE_PREFIX = "devhub:read-status:";

function storageKey(key: ReadStatusKey): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readSeenSignature(key: ReadStatusKey): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

function writeSeenSignature(key: ReadStatusKey, signature: string): void {
  if (typeof window === "undefined" || !signature) return;
  try {
    window.localStorage.setItem(storageKey(key), signature);
    window.dispatchEvent(new CustomEvent(READ_STATUS_EVENT, { detail: { key } }));
  } catch {
    // Read status is a convenience signal; storage failures should never break navigation.
  }
}

function subscribeReadStatus(onStoreChange: () => void): () => void {
  window.addEventListener(READ_STATUS_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(READ_STATUS_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useIsUnseen(key: ReadStatusKey, signature: string): boolean {
  const seen = useSyncExternalStore(
    subscribeReadStatus,
    () => readSeenSignature(key),
    () => null,
  );
  return Boolean(signature) && seen !== signature;
}

export function useMarkSeenOnVisit(key: ReadStatusKey, signature: string, active = true): boolean {
  const wasUnseenAtVisitStart = useSyncExternalStore(
    subscribeReadStatus,
    () => {
      if (!active || !signature) return null;
      return readSeenSignature(key);
    },
    () => null,
  );

  useEffect(() => {
    if (!active || !signature) return;
    writeSeenSignature(key, signature);
  }, [active, key, signature]);

  return Boolean(signature) && wasUnseenAtVisitStart !== signature;
}
