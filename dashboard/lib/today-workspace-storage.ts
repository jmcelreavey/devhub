"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_EVENT = "devhub:today-section-storage";

export const TODAY_SECTION_GITHUB_PRS_COLLAPSED = "devhub-today-github-prs-collapsed";
export const TODAY_SECTION_DATADOG_COLLAPSED = "devhub-today-datadog-collapsed";
export const TODAY_SECTION_WELCOME_COLLAPSED = "devhub-today-welcome-collapsed";
export const TODAY_SECTION_MAIN_COLLAPSED = "devhub-today-main-collapsed";
export const TODAY_SECTION_CALENDAR_COLLAPSED = "devhub-today-calendar-collapsed";
export const TODAY_SECTION_JIRA_COLLAPSED = "devhub-today-jira-collapsed";

function readCollapsed(key: string, defaultCollapsed = false): boolean {
  if (typeof window === "undefined") return defaultCollapsed;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return defaultCollapsed;
  return raw === "true";
}

function writeCollapsed(key: string, collapsed: boolean): void {
  if (collapsed) {
    window.localStorage.setItem(key, "true");
  } else {
    window.localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(STORAGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(STORAGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * Persisted open/closed for Today “deep signal” sections. `true` means body is collapsed.
 */
export function usePersistedSectionCollapsed(
  key: string,
  options?: { defaultCollapsed?: boolean },
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const defaultCollapsed = options?.defaultCollapsed ?? false;
  const collapsed = useSyncExternalStore(
    subscribe,
    () => readCollapsed(key, defaultCollapsed),
    () => defaultCollapsed,
  );
  const setCollapsed = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(readCollapsed(key, defaultCollapsed)) : next;
      writeCollapsed(key, resolved);
    },
    [key, defaultCollapsed],
  );
  return [collapsed, setCollapsed];
}
