"use client";

import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/lib/konami-sequence";
import { advanceBoo, type HollowRuntimePlan } from "@/lib/hollow-theme";
import { HOLLOW_BLOCKED, quietApparitionSlot, quietHollowSlots, quietSpiderColumn } from "./hollow-placement";
import { cancelScheduledHollowStop, resumeHollowSound, scheduleStopHollowSound,
  startHollowSound, suspendHollowSound } from "./hollow-audio";

const EDITOR = ".xterm, .cm-editor, .monaco-editor, .bn-root";
const TEXT_TARGET = `input, textarea, select, [contenteditable="true"], ${EDITOR}`;
const PROTECTED = `${EDITOR}, .terminal-dock, [role="dialog"], [role="menu"], .toast, .command-palette`;

function SpiderMark() {
  return (
    <svg viewBox="0 0 56 54" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M24 22 15 13 4 8 M23 25 10 21 1 28 M24 28 12 34 7 47 M26 30 22 41 20 53
          M32 22 42 12 51 6 M33 25 47 19 55 26 M32 28 44 35 50 47 M30 30 34 42 36 52" />
      </g>
      <ellipse cx="28" cy="22" rx="4" ry="5" fill="currentColor" />
      <ellipse cx="28" cy="31" rx="6" ry="8" fill="currentColor" />
    </svg>
  );
}

export function HollowEffects({ plan, preview, faceShot }: {
  plan: HollowRuntimePlan; preview: boolean; faceShot: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const fractureRef = useRef<HTMLDivElement>(null);
  const pairRefs = useRef<Array<HTMLDivElement | null>>([]);
  const irisRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const centers = useRef<Array<{ x: number; y: number }>>([]);
  const spiderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer = 0;
    const observed = new Set<Element>();
    const protectedResize = new ResizeObserver(scroll);
    function mask() {
      if (!root || document.hidden) return;
      const elements = new Set(document.querySelectorAll(PROTECTED));
      for (const el of observed) {
        if (!elements.has(el)) { protectedResize.unobserve(el); observed.delete(el); }
      }
      const holes = [...elements].flatMap((el) => {
        if (!observed.has(el)) { protectedResize.observe(el); observed.add(el); }
        const r = el.getBoundingClientRect();
        return r.width && r.height
          ? [`<rect x="${r.left - 1}" y="${r.top - 1}" width="${r.width + 2}" height="${r.height + 2}" fill="black"/>`] : [];
      }).join("");
      // Protect editors inside transformed panes without changing their stacking.
      root.style.maskImage = holes ? `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${innerHeight}"><rect width="100%" height="100%" fill="white"/>${holes}</svg>`,
      )}")` : "none";
      root.style.maskMode = "luminance";
    }
    function queueMask() {
      window.clearTimeout(timer);
      timer = window.setTimeout(mask, 80);
    }
    function scroll() {
      pairRefs.current.forEach((pair) => pair?.classList.remove("is-open"));
      spiderRef.current?.classList.remove("is-dropping", "is-hung");
      fractureRef.current?.classList.remove("is-visible");
      root?.querySelector(".hollow-face")?.classList.remove("is-showing", "is-held");
      queueMask();
    }
    function visibility() {
      document.documentElement.toggleAttribute("data-hollow-paused", document.hidden);
      if (!document.hidden) queueMask();
    }
    const observer = new MutationObserver(scroll);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", scroll);
    mask();
    visibility();
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      protectedResize.disconnect();
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", scroll);
      document.documentElement.removeAttribute("data-hollow-paused");
    };
  }, []);

  useEffect(() => {
    if (!plan.creatures && !plan.cursorTrail) return;
    let raf = 0;
    const mouse = { x: -9999, y: -9999, text: true };
    function frame() {
      raf = 0;
      if (document.hidden) return;
      if (plan.creatures) pairRefs.current.forEach((pair, i) => {
        const center = centers.current[i];
        if (!pair || !center || !pair.classList.contains("is-open")) return;
        const dx = mouse.x - center.x, dy = mouse.y - center.y;
        const distance = Math.hypot(dx, dy) || 1;
        pair.classList.toggle("is-shut", distance < 130);
        const reach = Math.min(2, distance) / distance;
        for (const side of [0, 1]) {
          const iris = irisRefs.current[i * 2 + side];
          if (iris) iris.style.transform = `translate(${dx * reach}px, ${dy * reach}px)`;
        }
      });
      const trail = trailRef.current;
      if (trail) {
        trail.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`;
        trail.style.opacity = mouse.text ? "0" : "0.22";
      }
    }
    function move(event: PointerEvent) {
      mouse.x = event.clientX; mouse.y = event.clientY;
      // Keep the cursor tint out of the contrast budget for text and controls.
      mouse.text = event.target instanceof Element && (
        Boolean(event.target.closest(`${TEXT_TARGET}, ${HOLLOW_BLOCKED}`))
        || [...event.target.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim())
      );
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function hide() {
      cancelAnimationFrame(raf); raf = 0;
      if (trailRef.current) trailRef.current.style.opacity = "0";
    }
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("pointerleave", hide);
    return () => {
      hide();
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("pointerleave", hide);
    };
  }, [plan.creatures, plan.cursorTrail]);

  useEffect(() => {
    if (!plan.creatures) return;
    const pairs = pairRefs.current;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
    };
    function clear() {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      pairs.forEach((pair) => pair?.classList.remove("is-open", "is-shut"));
      spiderRef.current?.classList.remove("is-dropping", "is-hung");
    }
    function place() {
      const points = quietHollowSlots(preview || Math.random() < 0.15 ? 2 : 1, preview);
      centers.current = points;
      pairs.forEach((pair, i) => {
        if (!pair) return;
        pair.classList.remove("is-shut");
        const point = points[i];
        pair.classList.toggle("is-open", Boolean(point));
        if (point) {
          pair.style.left = `${point.x}px`; pair.style.top = `${point.y}px`;
        }
      });
      const spider = spiderRef.current;
      if (spider && (preview || Math.random() < 0.4)) {
        const x = quietSpiderColumn();
        if (x !== null) {
          spider.style.left = `${x - 44}px`;
          spider.classList.add(preview ? "is-hung" : "is-dropping");
          if (!preview) later(() => spider.classList.remove("is-dropping"), 14000);
        }
      }
      if (!preview) later(() => pairs.forEach((pair) => pair?.classList.remove("is-open")), 7200);
    }
    let attempts = 0;
    function arm() {
      if (document.hidden) return;
      later(() => {
        place();
        if (!preview || ++attempts < 12) arm();
      }, preview ? 1000 : 18000 + Math.random() * 14000);
    }
    function visibility() { clear(); if (!document.hidden) arm(); }
    arm();
    document.addEventListener("visibilitychange", visibility);
    return () => { clear(); document.removeEventListener("visibilitychange", visibility); };
  }, [plan.creatures, preview]);

  useEffect(() => {
    if (!plan.cracks) return;
    const node = fractureRef.current;
    if (!node) return;
    const fracture = node;
    let active: Element | null = null;
    function hover(event: PointerEvent) {
      const card = event.target instanceof Element ? event.target.closest(".card, .hub-card, .btn-primary") : null;
      if (card === active) return;
      active = card;
      fracture.classList.remove("is-visible");
      if (!card || card.closest(EDITOR)) return;
      const rect = card.getBoundingClientRect();
      fracture.style.left = `${rect.left}px`; fracture.style.top = `${rect.top}px`;
      fracture.style.width = `${Math.min(96, rect.width)}px`;
      fracture.style.height = `${Math.min(96, rect.height)}px`;
      fracture.classList.add("is-visible");
    }
    window.addEventListener("pointerover", hover, { passive: true });
    return () => window.removeEventListener("pointerover", hover);
  }, [plan.cracks]);

  useEffect(() => {
    if (!plan.glitch) return;
    let timer = 0, clear = 0;
    let marked: HTMLElement | null = null;
    function unmark() {
      marked?.classList.remove("hollow-glitch");
      marked?.removeAttribute("data-text"); marked = null;
    }
    function mark() {
      unmark();
      const el = document.querySelector(".hub-hero-date") ?? document.querySelector("h1, .page-title");
      if (el instanceof HTMLElement && !el.closest(EDITOR)) {
        marked = el; el.dataset.text = el.textContent?.trim() ?? "";
        el.classList.add("hollow-glitch");
      }
    }
    let attempts = 0;
    function arm() {
      timer = window.setTimeout(() => {
        if (!document.hidden) {
          mark();
          if (!preview) clear = window.setTimeout(unmark, 560);
        }
        if (!preview || ++attempts < 8) arm();
      }, preview ? 1500 : 32000 + Math.random() * 30000);
    }
    function visibility() {
      window.clearTimeout(timer); window.clearTimeout(clear); unmark();
      if (!document.hidden) arm();
    }
    arm();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(timer); window.clearTimeout(clear); unmark();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [plan.glitch, preview]);

  useEffect(() => {
    if (!plan.jumpScares) return;
    let index = 0, hideTimer = 0, rare = 0;
    function hide() { document.querySelector(".hollow-face")?.classList.remove("is-showing"); }
    function show() {
      if (document.hidden) return;
      const face = document.querySelector(".hollow-face");
      if (!(face instanceof HTMLElement) || face.classList.contains("is-showing")) return;
      const slot = quietApparitionSlot();
      if (!slot) return;
      face.style.left = `${slot.x}px`; face.style.top = `${slot.y}px`;
      face.classList.add(faceShot ? "is-held" : "is-showing");
      if (!faceShot) hideTimer = window.setTimeout(hide, 4800);
    }
    function key(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || (event.target instanceof Element && event.target.closest(EDITOR))
        || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.key.length !== 1) return;
      const next = advanceBoo(index, event.key);
      index = next === "trigger" ? 0 : next;
      if (next === "trigger") show();
    }
    function arm() { rare = window.setTimeout(() => { show(); arm(); }, 180000 + Math.random() * 180000); }
    function visibility() {
      window.clearTimeout(rare); window.clearTimeout(hideTimer); hide();
      if (!document.hidden) arm();
    }
    if (faceShot) {
      let attempts = 0;
      const retry = window.setInterval(() => {
        show();
        if (++attempts === 12) window.clearInterval(retry);
      }, 1000);
      return () => window.clearInterval(retry);
    }
    arm();
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(rare); window.clearTimeout(hideTimer); hide();
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [faceShot, plan.jumpScares]);

  useEffect(() => {
    if (!plan.sound) return;
    cancelScheduledHollowStop();
    const onPointer = () => startHollowSound();
    const onVisibility = () => { if (document.hidden) suspendHollowSound(); else resumeHollowSound(); };
    window.addEventListener("pointerdown", onPointer);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      scheduleStopHollowSound();
    };
  }, [plan.sound]);

  return (
    <div className="hollow-fx" ref={rootRef} aria-hidden="true">
      {plan.creatures ? [0, 1].map((index) => (
        <div key={index} className="hollow-pair" ref={(node) => { pairRefs.current[index] = node; }}>
          {[0, 1].map((side) => (
            <span className="hollow-socket" key={side}>
              <span className="hollow-iris" ref={(node) => { irisRefs.current[index * 2 + side] = node; }} />
            </span>
          ))}
        </div>
      )) : null}
      {plan.creatures ? <div className="hollow-spider" ref={spiderRef}><SpiderMark /></div> : null}
      {plan.jumpScares ? <div className="hollow-face" /> : null}
      {plan.grain ? (
        <div className="hollow-atmosphere">
          <div className="hollow-keylight" />
          <div className="hollow-fog hollow-fog-far" />
          <div className="hollow-fog hollow-fog-near" />
          <div className="hollow-vignette" />
          <div className="hollow-fog-edge" />
          <div className="hollow-patina" />
          <div className="hollow-grain" />
          <div className="hollow-scan" />
          <div className="hollow-roll" />
        </div>
      ) : null}
      {plan.cracks ? <div className="hollow-fracture" ref={fractureRef}><span /></div> : null}
      {plan.cursorTrail ? <div className="hollow-cursor-trail" ref={trailRef} /> : null}
    </div>
  );
}
