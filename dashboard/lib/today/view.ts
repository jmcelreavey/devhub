"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Today page view mode (2026-06 UX pass):
 * - "focus"     — design B · Calm Focus: one thing now, the rest whispers (default)
 * - "dashboard" — design A+B combo: draggable grid with NOW card
 *
 * Persisted in localStorage; switchable from the Layout popover.
 */
export type TodayView = "focus" | "dashboard";

const KEY = "devhub:today-view";
const EVENT = "devhub:today-view-change";

export function readTodayView(): TodayView {
  if (typeof window === "undefined") return "focus";
  return window.localStorage.getItem(KEY) === "dashboard" ? "dashboard" : "focus";
}

export function writeTodayView(view: TodayView): void {
  try {
    window.localStorage.setItem(KEY, view);
  } catch {
    // private mode / quota — the event still updates this session
  }
  window.dispatchEvent(new Event(EVENT));
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
  const view = useSyncExternalStore(subscribe, readTodayView, () => "focus" as TodayView);
  const setView = useCallback((v: TodayView) => writeTodayView(v), []);
  return [view, setView];
}
