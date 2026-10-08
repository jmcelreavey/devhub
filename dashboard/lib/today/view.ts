"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Today page view mode (2026-06 UX pass):
 * - "focus"     — Calm Focus: one thing now, the rest whispers
 * - "dashboard" — draggable grid with NOW card (default)
 *
 * Persisted on the machine (`/api/ui-prefs/today-view`) so every origin the app
 * is served from agrees, with localStorage as the instant cache and the
 * fallback when the server is unreachable. A choice made before the server copy
 * existed is migrated up once. Switchable from the Layout popover.
 */
export type TodayView = "focus" | "dashboard";

const KEY = "devhub:today-view";
const EVENT = "devhub:today-view-change";

export function readTodayView(): TodayView {
  if (typeof window === "undefined") return "dashboard";
  try {
    return window.localStorage.getItem(KEY) === "focus" ? "focus" : "dashboard";
  } catch {
    return "dashboard";
  }
}

/** The cache only: no server round trip, so a value that came from the server can't echo back. */
function cacheTodayView(view: TodayView): void {
  try {
    window.localStorage.setItem(KEY, view);
  } catch {
    // private mode / quota — the event still updates this session
  }
  window.dispatchEvent(new Event(EVENT));
}

function saveTodayViewToServer(view: TodayView): Promise<unknown> {
  return fetch("/api/ui-prefs/today-view", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view }),
  }).catch(() => undefined);
}

export function writeTodayView(view: TodayView): void {
  cacheTodayView(view);
  void saveTodayViewToServer(view);
}

function hasLocalChoice(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Reconcile this origin's cache with the machine's saved choice: the server
 * wins when it has one; otherwise a local choice is uploaded once.
 */
export async function syncTodayView(): Promise<void> {
  let saved: unknown;
  try {
    const response = await fetch("/api/ui-prefs/today-view", { cache: "no-store" });
    if (!response.ok) return;
    saved = ((await response.json()) as { view?: unknown }).view;
  } catch {
    return;
  }
  if (saved === "focus" || saved === "dashboard") {
    if (saved !== readTodayView() || !hasLocalChoice()) cacheTodayView(saved);
  } else if (hasLocalChoice()) {
    await saveTodayViewToServer(readTodayView());
  }
}

let syncing: Promise<void> | null = null;

/** Several components read the view; one round trip per page load is enough. */
function syncTodayViewOnce(): Promise<void> {
  syncing ??= syncTodayView();
  return syncing;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useTodayView(): [TodayView, (view: TodayView) => void] {
  const view = useSyncExternalStore(subscribe, readTodayView, () => "dashboard" as TodayView);
  useEffect(() => { void syncTodayViewOnce(); }, []);
  const setView = useCallback((v: TodayView) => writeTodayView(v), []);
  return [view, setView];
}
