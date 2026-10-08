"use client";

import { useEffect, useRef } from "react";
import type { HollowRuntimePlan } from "@/lib/hollow-theme";

/** Stronger exposures are masked out of every card, control and text run. */
export function HollowRoom({ plan }: { plan: HollowRuntimePlan }) {
  const roomRef = useRef<HTMLDivElement>(null);
  const trails = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !plan.rareEvents) return;
    const root = room.closest(".hollow-fx");
    const preview = new URLSearchParams(location.search).get("hollowRare") === "1";
    let timer = 0, end = 0;
    const clear = () => {
      window.clearTimeout(timer); window.clearTimeout(end);
      root?.classList.remove("is-rare", "is-rare-preview");
    };
    function arm() {
      if (document.hidden) return;
      if (preview) { root?.classList.add("is-rare", "is-rare-preview"); return; }
      timer = window.setTimeout(() => {
        root?.classList.add("is-rare");
        end = window.setTimeout(() => { root?.classList.remove("is-rare"); arm(); }, 14000);
      }, 180000 + Math.random() * 120000);
    }
    const visibility = () => { clear(); arm(); };
    arm();
    document.addEventListener("visibilitychange", visibility);
    return () => { clear(); document.removeEventListener("visibilitychange", visibility); };
  }, [plan.rareEvents]);

  useEffect(() => {
    if (!plan.cursorTrail) return;
    const animations = new Map<HTMLDivElement, Animation>();
    let next = 0;
    function leave(event: PointerEvent) {
      if (document.hidden || !(event.target instanceof Element)) return;
      const card = event.target.closest(".hub-card, .card, .task-row, [role='row']");
      if (!card || card.closest(".cm-editor, .xterm, .monaco-editor, .bn-root")) return;
      if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
      const node = trails.current[next++ % 4];
      if (!node) return;
      animations.get(node)?.cancel();
      // Coordinates come from the event. No geometry reads on pointer frames.
      const transform = `translate3d(${event.clientX - 75}px, ${event.clientY - 32}px, 0)`;
      const animation = node.animate([
        { opacity: .05, transform: transform + " scale(.75)" },
        { opacity: .5, offset: .18, transform: transform + " scale(1)" },
        { opacity: 0, transform: transform + " translateY(-18px) scale(1.35)" },
      ], { duration: 600, easing: "ease-out" });
      animations.set(node, animation);
    }
    const stop = () => { animations.forEach(animation => animation.cancel()); animations.clear(); };
    window.addEventListener("pointerout", leave, { passive: true });
    document.addEventListener("visibilitychange", stop);
    document.addEventListener("scroll", stop, true);
    return () => {
      stop();
      window.removeEventListener("pointerout", leave);
      document.removeEventListener("visibilitychange", stop);
      document.removeEventListener("scroll", stop, true);
    };
  }, [plan.cursorTrail]);

  return <div className="hollow-room" ref={roomRef}>
    {plan.grain ? <>
      <div className="hollow-room-backlight" />
      {plan.rareEvents ? <div className="hollow-passing-shadow" /> : null}
      <div className="hollow-fog hollow-fog-far" />
      <div className="hollow-fog hollow-fog-near" />
      <div className="hollow-fog hollow-fog-mid" />
      <div className="hollow-cobweb hollow-cobweb-left"><i /></div>
      <div className="hollow-cobweb hollow-cobweb-right"><i /></div>
    </> : null}
    {plan.cursorTrail ? [0, 1, 2, 3].map(index =>
      <div className="hollow-spectral-trail" key={index} ref={node => { trails.current[index] = node; }} />
    ) : null}
  </div>;
}
