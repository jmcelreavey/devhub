"use client";

import { useSecondTick } from "@/lib/tickers";
import { formatClock } from "./hero-helpers";

/**
 * Wall clock. Renders only this span each tick, and now shares one interval
 * with every other second-resolution readout in the app (lib/tickers.ts)
 * instead of owning a `setInterval` of its own. Still stops while the tab is
 * hidden — that behaviour moved into the shared ticker.
 *
 * It displays hours and minutes, so a minute ticker looks tempting. Don't: the
 * shared minute interval starts whenever its first subscriber mounts, not on
 * the minute boundary, so the clock would sit on the wrong minute for up to
 * 59s after each rollover. Ticking per second and re-rendering one span is the
 * cheaper mistake.
 */
export function LiveClock() {
  // 0 only during SSR, where `suppressHydrationWarning` covers the mismatch;
  // on the client the ticker seeds itself on first read.
  const now = useSecondTick();
  const clock = formatClock(new Date(now));

  return (
    <span
      className="font-mono text-[13px]"
      aria-label={`Current time ${clock}`}
      suppressHydrationWarning
    >
      {clock}
    </span>
  );
}
