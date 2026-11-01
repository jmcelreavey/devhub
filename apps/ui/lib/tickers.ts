"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared wall-clock heartbeats.
 *
 * Components that display elapsed or current time used to own a `setInterval`
 * each — the Today page alone ran four independent 1 Hz timers, so four
 * separate wake-ups and four separate render trees every second. These tickers
 * are refcounted: N subscribers share one interval, and the interval only
 * exists while someone is listening.
 *
 * They also stop while the tab is hidden. There is nothing to repaint in a
 * background tab, and on a laptop a 1 Hz wake-up is measurable battery. On
 * becoming visible again the timestamp is refreshed and subscribers are
 * notified immediately, so nothing shows a stale value even for one frame.
 *
 * `getSnapshot` MUST return a stable value between ticks, or
 * `useSyncExternalStore` re-renders on every commit and React kills the loop.
 * Hence the cached timestamp, only reassigned inside the interval.
 */
interface Ticker {
  subscribe: (cb: () => void) => () => void;
  getNow: () => number;
}

function createTicker(intervalMs: number): Ticker {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let cachedNow = 0;
  let visibilityBound = false;

  const notify = () => listeners.forEach((cb) => cb());

  const start = () => {
    if (timer || typeof window === "undefined") return;
    cachedNow = Date.now();
    timer = setInterval(() => {
      cachedNow = Date.now();
      notify();
    }, intervalMs);
  };

  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      stop();
      return;
    }
    // Catch up before resuming — the cached value is as stale as the time spent
    // hidden, which for a minute ticker could be hours.
    cachedNow = Date.now();
    notify();
    start();
  };

  const bindVisibility = () => {
    if (visibilityBound || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", onVisibilityChange);
    visibilityBound = true;
  };

  const unbindVisibility = () => {
    if (!visibilityBound || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityBound = false;
  };

  return {
    subscribe(cb: () => void) {
      bindVisibility();
      if (typeof document === "undefined" || !document.hidden) start();
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) {
          stop();
          unbindVisibility();
        }
      };
    },
    /**
     * Self-seeds on the first read. `useSyncExternalStore` calls getSnapshot
     * during render, before subscribe runs in an effect — so without this the
     * first client render would see 0 and every caller would need its own
     * `now || Date.now()` fallback, which is an impure call during render and
     * is exactly what `react-hooks/purity` (correctly) rejects.
     *
     * Reading the clock once and caching it keeps the snapshot stable between
     * ticks, which is the contract that matters here.
     */
    getNow: () => {
      if (cachedNow === 0 && typeof window !== "undefined") cachedNow = Date.now();
      return cachedNow;
    },
  };
}

const secondTicker = createTicker(1_000);
const minuteTicker = createTicker(60_000);

/** Server snapshot — 0 so SSR output is deterministic; the client corrects on mount. */
const serverNow = () => 0;

/**
 * Milliseconds-since-epoch that advances once a second while the tab is
 * visible. Pass `active: false` (e.g. a stopped timer) to unsubscribe and let
 * the shared interval wind down when nobody needs it.
 */
export function useSecondTick(active = true): number {
  return useSyncExternalStore(
    active ? secondTicker.subscribe : noopSubscribe,
    active ? secondTicker.getNow : serverNow,
    serverNow,
  );
}

/** As `useSecondTick`, but once a minute. */
export function useMinuteTick(active = true): number {
  return useSyncExternalStore(
    active ? minuteTicker.subscribe : noopSubscribe,
    active ? minuteTicker.getNow : serverNow,
    serverNow,
  );
}

function noopSubscribe(): () => void {
  return () => {};
}

/** @deprecated Prefer `useMinuteTick()`. Kept for existing callers. */
export const subscribeMinute = minuteTicker.subscribe;
/** @deprecated Prefer `useMinuteTick()`. Kept for existing callers. */
export const getNow = minuteTicker.getNow;
