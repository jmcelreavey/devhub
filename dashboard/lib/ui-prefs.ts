"use client";

/**
 * Density + motion preferences (2026-06 UX pass).
 *
 * - density: "comfortable" (default) | "compact" — applied as
 *   `body[data-density]`, consumed by globals.css overrides.
 * - motion: true (default) | false — `body[data-motion="off"]` kills all
 *   animation/transition. `prefers-reduced-motion` is respected separately
 *   by the individual keyframes.
 *
 * Stored in localStorage; toggled from the ⌘K palette.
 */

export type Density = "comfortable" | "compact";

const DENSITY_KEY = "devhub:ui-density";
const MOTION_KEY = "devhub:ui-motion";

export function readDensity(): Density {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}

export function readMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MOTION_KEY) !== "off";
}

export function applyUiPrefs(): void {
  if (typeof document === "undefined") return;
  document.body.dataset.density = readDensity();
  document.body.dataset.motion = readMotion() ? "on" : "off";
}

export function toggleDensity(): Density {
  const next: Density = readDensity() === "compact" ? "comfortable" : "compact";
  try {
    window.localStorage.setItem(DENSITY_KEY, next);
  } catch {
    // private mode / quota — apply for this session anyway
  }
  applyUiPrefs();
  return next;
}

export function toggleMotion(): boolean {
  const next = !readMotion();
  try {
    window.localStorage.setItem(MOTION_KEY, next ? "on" : "off");
  } catch {
    // private mode / quota — apply for this session anyway
  }
  applyUiPrefs();
  return next;
}
