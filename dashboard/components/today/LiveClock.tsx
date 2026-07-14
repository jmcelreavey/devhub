"use client";

import { useEffect, useState } from "react";
import { formatClock } from "./hero-helpers";

/**
 * Self-ticking seconds clock. Isolated so its 1s interval re-renders only
 * this span — previously the whole Today page re-rendered every second.
 * Pauses while the tab is hidden.
 */
export function LiveClock() {
  const [clock, setClock] = useState<string>(() => formatClock(new Date()));
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => setClock(formatClock(new Date()));
    const start = () => {
      if (id) return;
      tick();
      id = setInterval(tick, 1000);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return (
    <span className="font-mono text-[13px]" aria-label={`Current time ${clock}`} suppressHydrationWarning>
      {clock}
    </span>
  );
}
