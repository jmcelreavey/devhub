"use client";

import { useEffect, useRef } from "react";
import { GRAPHITE_CELEBRATE_EVENT } from "@/lib/graphite-theme";
import { GraphiteCursorFollower } from "./GraphiteCursorFollower";
import { THEME_EFFECTS } from "@/lib/theme-effects";
import { ThemeMark } from "@/components/themes/ThemeMark";

/** Unmounted by GraphiteGate when the theme changes or motion stops. */
export function GraphiteEffects({ cursor, celebrations, preset = "graphite" }: { cursor: boolean; celebrations: boolean; preset?: string }) {
  const celebration = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!celebrations) return;
    const root = celebration.current;
    if (!root) return;
    let animation: Animation | undefined;
    const celebrate = (event: Event) => {
      if (!(event instanceof CustomEvent) || !["task", "merge"].includes(event.detail) || document.hidden) return;
      const label = root.querySelector("span");
      if (label) label.textContent = (event.detail === "merge" ? THEME_EFFECTS[preset]?.mergeMessage : THEME_EFFECTS[preset]?.taskMessage) ?? "Done.";
      animation?.cancel();
      animation = root.animate([
        { opacity: 0, transform: "translate3d(-50%, 12px, 0) scale(.96)" },
        { opacity: 1, transform: "translate3d(-50%, 0, 0) scale(1)", offset: .12 },
        { opacity: 1, transform: "translate3d(-50%, 0, 0) scale(1)", offset: .82 },
        { opacity: 0, transform: "translate3d(-50%, -8px, 0) scale(1)" },
      ], { duration: 1800, easing: "cubic-bezier(.22,1,.36,1)" });
    };
    window.addEventListener(GRAPHITE_CELEBRATE_EVENT, celebrate);
    return () => {
      window.removeEventListener(GRAPHITE_CELEBRATE_EVENT, celebrate);
      animation?.cancel();
    };
  }, [celebrations, preset]);

  return (
    <>
      {cursor && <GraphiteCursorFollower className={preset === "graphite" ? undefined : "theme-cursor-follower"} />}
      {celebrations && <div ref={celebration} className={`graphite-celebration${preset !== "graphite" ? " theme-celebration" : ""}`}  aria-hidden="true">
        {preset !== "graphite" ? <ThemeMark preset={preset} /> : <svg viewBox="0 0 32 32" width="32" height="32"><path d="M5 6h15M5 26h15M5 16h9" /><rect x="18" y="11" width="10" height="10" rx="2" /><path className="graphite-celebration-check" d="m20 16 2 2 4-4" /></svg>}
        <span />
      </div>}
    </>
  );
}
