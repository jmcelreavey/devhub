"use client";

import { useEffect, useRef } from "react";

const PROTECTED = [
  "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='button']):not([type='submit']):not([type='reset'])",
  "textarea", "select", "[contenteditable]:not([contenteditable='false'])", "[role='textbox']",
  ".cm-editor", ".monaco-editor", ".bn-root", ".xterm", ".terminal-dock", ".terminal-blocks-view", "iframe",
].join(", ");
const CLICKABLE = "a[href], button, summary, label[for], input, [role='button'], [role='link'], [role='switch'], [role='checkbox'], [role='radio'], [role='tab'], [role^='menuitem']";

/** One compositor-only loop, asleep as soon as the ring catches up. */
export function GraphiteCursorFollower({ className = "graphite-cursor-follower" }: { className?: string }) {
  const follower = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ring = follower.current;
    const wash = fill.current;
    if (!ring || !wash) return;
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let previousTime = 0;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;
    let scale = 1;
    let targetScale = 1;
    let fillScale = 0;
    let targetFill = 0;

    const paint = () => {
      ring.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
      wash.style.transform = `scale(${fillScale})`;
    };
    const hide = () => {
      ring.hidden = true;
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
    };
    const tick = (time: number) => {
      // Time-based damping keeps the same short lag on 60Hz and 120Hz screens.
      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      const positionEase = 1 - Math.exp(-elapsed / 55);
      const stateEase = 1 - Math.exp(-elapsed / 45);
      x += (targetX - x) * positionEase;
      y += (targetY - y) * positionEase;
      scale += (targetScale - scale) * stateEase;
      fillScale += (targetFill - fillScale) * stateEase;
      const settled = Math.abs(targetX - x) < .1 && Math.abs(targetY - y) < .1
        && Math.abs(targetScale - scale) < .001 && Math.abs(targetFill - fillScale) < .001;
      if (settled) {
        x = targetX;
        y = targetY;
        scale = targetScale;
        fillScale = targetFill;
      }
      paint();
      frame = settled ? 0 : requestAnimationFrame(tick);
      if (settled) previousTime = 0;
    };
    const move = (event: PointerEvent) => {
      const target = event.target;
      if (!pointer.matches || event.pointerType !== "mouse" || document.hidden
        || !(target instanceof Element) || target.closest(PROTECTED)) {
        hide();
        return;
      }
      const control = target.closest(CLICKABLE);
      const clickable = control !== null && !control.closest(":disabled, [aria-disabled='true'], [inert]");
      targetX = event.clientX;
      targetY = event.clientY;
      targetScale = event.buttons & 1 ? .76 : clickable ? 1.3 : 1;
      targetFill = clickable ? 1 : 0;
      if (ring.hidden) {
        // Re-enter at the pointer: never sweep across text from an old position.
        x = targetX;
        y = targetY;
        scale = targetScale;
        fillScale = targetFill;
        paint();
        ring.hidden = false;
      }
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) hide();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Tab") hide();
    };
    const events = ["pointermove", "pointerover", "pointerdown", "pointerup"] as const;
    for (const event of events) window.addEventListener(event, move, { passive: true, capture: true });
    window.addEventListener("pointerout", leave);
    window.addEventListener("pointercancel", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("dragstart", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", keyboard);
    document.addEventListener("visibilitychange", hide);
    pointer.addEventListener("change", hide);
    return () => {
      hide();
      for (const event of events) window.removeEventListener(event, move, true);
      window.removeEventListener("pointerout", leave);
      window.removeEventListener("pointercancel", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("dragstart", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", keyboard);
      document.removeEventListener("visibilitychange", hide);
      pointer.removeEventListener("change", hide);
    };
  }, []);

  return <div ref={follower} className={className} hidden aria-hidden="true"><span ref={fill} /></div>;
}
