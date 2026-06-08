"use client";

// Shared one-minute heartbeat — lets components depending on `now` re-render
// once per minute without each one owning its own setInterval.
//
// `getSnapshot` MUST return a stable value between subscribe ticks; otherwise
// useSyncExternalStore re-renders on every commit and React kills the loop.
// We cache the timestamp and only update it inside the interval.

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let cachedNow = 0;

function ensureTimer() {
  if (timer || typeof window === "undefined") return;
  cachedNow = Date.now();
  timer = setInterval(() => {
    cachedNow = Date.now();
    listeners.forEach((cb) => cb());
  }, 60_000);
}

export function subscribeMinute(cb: () => void) {
  ensureTimer();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function getNow(): number {
  return cachedNow;
}
