"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BRAND_BOTTLE_IMAGE_SRC } from "@/lib/brand-mark";

export type BootState = "loading" | "leaving" | "done";

const MIN_SHOW_MS = 350;
const MAX_WAIT_MS = 3500;
const EXIT_MS = 320;

/**
 * Coordinates a page boot screen: one loading moment instead of scattered
 * skeleton pops. Content resolves *behind* the opaque overlay; when it
 * lifts, the page is already settled. Used site-wide via BootGate.
 *
 * - Skips entirely when SWR cache is warm (revisits show no boot at all).
 * - Minimum display 350ms so a fast load doesn't flash.
 * - Maximum wait 3.5s — slow APIs don't hold the door; stragglers fill in
 *   behind their own (now rarely seen) skeletons.
 */
export function useBootGate(dataReady: boolean): BootState {
  // Lazy init: if data was already cached at first render, never boot.
  const [state, setState] = useState<BootState>(() => (dataReady ? "done" : "loading"));
  // Render-pure: stamped on first effect run rather than during render.
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (state !== "loading") return;
    if (startRef.current === null) startRef.current = Date.now();
    const elapsed = Date.now() - startRef.current;
    const delay = dataReady
      ? Math.max(0, MIN_SHOW_MS - elapsed)
      : Math.max(0, MAX_WAIT_MS - elapsed);
    const t = setTimeout(() => setState("leaving"), delay);
    return () => clearTimeout(t);
  }, [dataReady, state]);

  useEffect(() => {
    if (state !== "leaving") return;
    const t = setTimeout(() => setState("done"), EXIT_MS);
    return () => clearTimeout(t);
  }, [state]);

  return state;
}

const BOOT_LINES = [
  "Pouring the coffee…",
  "Counting unfinished business…",
  "Asking Jira nicely…",
  "Untangling the timeline…",
  "Sharpening the pixels…",
  "Negotiating with the calendar…",
];

/**
 * Full-screen branded boot moment. Brand mark with an orbiting ring, a dry
 * rotating status line, and a shimmer bar. Fades out as one unit.
 */
export function TodayBootScreen({ state }: { state: BootState }) {
  const [lineIdx, setLineIdx] = useState(0);

  useEffect(() => {
    if (state !== "loading") return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % BOOT_LINES.length), 800);
    return () => clearInterval(t);
  }, [state]);

  if (state === "done") return null;

  return (
    <div
      className={`boot-screen${state === "leaving" ? " boot-screen-leaving" : ""}`}
      role="status"
      aria-label="Loading DevHub"
    >
      <div className="boot-mark">
        <span className="boot-ring" aria-hidden />
        <Image
          src={BRAND_BOTTLE_IMAGE_SRC}
          alt=""
          width={56}
          height={56}
          unoptimized
          priority
          className="boot-logo"
        />
      </div>
      <div className="boot-title">DevHub</div>
      <div className="boot-line" aria-hidden>
        <span key={lineIdx} className="boot-line-text">
          {BOOT_LINES[lineIdx]}
        </span>
      </div>
      <div className="boot-bar" aria-hidden>
        <i />
      </div>
    </div>
  );
}

/** Back-compat aliases — the boot system started life on the Today views. */
export const useTodayBoot = useBootGate;
export const BootScreen = TodayBootScreen;

/**
 * Site-wide gate: overlays the boot screen until `ready`, while children
 * render (and fetch) behind it. Drop-in wrapper for page client components:
 *
 *   <BootGate ready={data !== undefined || !!error}>…page…</BootGate>
 */
export function BootGate({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  const state = useBootGate(ready);
  return (
    <>
      <TodayBootScreen state={state} />
      {children}
    </>
  );
}
