"use client";

import { ShiftDockMark } from "@/components/graphite/ShiftDockMark";
import { THEME_EFFECTS } from "@/lib/theme-effects";

const MARK_PATHS = {
  hollow: "M10 27V14a6 6 0 0 1 12 0v13M7 27h18M13 19h6M16 12v3",
  ember: "M16 4c3 7 10 10 10 17a10 10 0 0 1-20 0c0-5 3-8 5-10 0 4 1 6 3 7 3-4 3-8 2-14Z",
  sonar: "M4 16a12 12 0 1 0 24 0 12 12 0 1 0-24 0M9 16a7 7 0 1 0 14 0 7 7 0 1 0-14 0M16 16l8-8",
  lantern: "M10 6h12M16 3v3M8 10h16l-2 16H10L8 10ZM12 14h8M16 10v16M12 29h8",
  petal: "M16 26C3 22 3 9 7 6c6 0 9 6 9 12C16 12 19 6 25 6c4 3 4 16-9 20ZM16 26V15",
};

export function ThemeMark({ preset, className = "" }: { preset: string; className?: string }) {
  const mark = THEME_EFFECTS[preset]?.mark;
  if (!mark || mark === "dock") return <ShiftDockMark className={className} />;
  return <svg viewBox="0 0 32 32" className={`theme-signature-mark ${className}`} data-mark={mark} aria-hidden="true">
    <path className="theme-mark-stroke" d={MARK_PATHS[mark]} />
    <circle className="theme-mark-heart" cx="16" cy={mark === "ember" ? "23" : "16"} r="2" />
  </svg>;
}
