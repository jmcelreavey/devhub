"use client";

import { useEffect, useRef } from "react";
import { RUNTIME_THEME_EDITING, RUNTIME_THEME_PROTECTED } from "@/lib/plugins/runtime-theme-layout";
import type { PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";

function paused(): boolean {
  return document.hidden || Boolean(document.activeElement?.closest(RUNTIME_THEME_EDITING));
}

export function RuntimeThemeDecorations({ theme, interaction, motion, preview }: {
  theme: PublicRuntimeTheme; interaction: boolean; motion: boolean; preview: boolean;
}) {
  const fracture = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-runtime-hollow-paused");
    const previousDecorations = root.getAttribute("data-runtime-hollow-decorations");
    let active = true;
    const update = () => root.toggleAttribute("data-runtime-hollow-paused", paused());
    const settled = () => queueMicrotask(() => { if (active) update(); });
    root.setAttribute("data-runtime-hollow-decorations", "on");
    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", settled);
    document.addEventListener("visibilitychange", update);
    return () => {
      active = false;
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", settled);
      document.removeEventListener("visibilitychange", update);
      if (previous === null) root.removeAttribute("data-runtime-hollow-paused");
      else root.setAttribute("data-runtime-hollow-paused", previous);
      if (previousDecorations === null) root.removeAttribute("data-runtime-hollow-decorations");
      else root.setAttribute("data-runtime-hollow-decorations", previousDecorations);
    };
  }, []);

  useEffect(() => {
    const node = fracture.current;
    if (!interaction || !theme.hostDecorations?.hoverCrack || !node) return;
    const overlay = node;
    let active: Element | null = null;
    const hide = () => { active = null; overlay.classList.remove("is-visible"); };
    function hover(event: PointerEvent) {
      if (paused() || !(event.target instanceof Element)) { hide(); return; }
      const card = event.target.closest(".card, .hub-card, .btn-primary");
      if (card === active) return;
      hide();
      if (!card || card.closest(RUNTIME_THEME_PROTECTED)) return;
      const rect = card.getBoundingClientRect();
      if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return;
      active = card;
      overlay.style.left = `${rect.left}px`; overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${Math.min(96, rect.width)}px`; overlay.style.height = `${Math.min(96, rect.height)}px`;
      overlay.classList.add("is-visible");
    }
    function leave(event: PointerEvent) {
      if (active && event.target instanceof Node && active.contains(event.target)
        && (!(event.relatedTarget instanceof Node) || !active.contains(event.relatedTarget))) hide();
    }
    window.addEventListener("pointerover", hover, { passive: true });
    window.addEventListener("pointerout", leave, { passive: true });
    for (const event of ["scroll", "resize", "blur", "dragstart", "keydown", "focusin"]) window.addEventListener(event, hide, true);
    document.addEventListener("visibilitychange", hide);
    return () => {
      hide();
      window.removeEventListener("pointerover", hover);
      window.removeEventListener("pointerout", leave);
      for (const event of ["scroll", "resize", "blur", "dragstart", "keydown", "focusin"]) window.removeEventListener(event, hide, true);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [theme.hostDecorations, interaction]);

  useEffect(() => {
    if (!interaction || !motion || !theme.hostDecorations?.headingGlitch) return;
    let timer = 0, clear = 0, attempts = 0, active = true;
    let marked: { element: HTMLElement; text: string | null; glitch: boolean; preview: boolean } | null = null;
    function unmark() {
      if (!marked) return;
      const { element, text, glitch, preview: hadPreview } = marked;
      if (text === null) element.removeAttribute("data-runtime-hollow-text");
      else element.setAttribute("data-runtime-hollow-text", text);
      if (!glitch) element.classList.remove("runtime-hollow-glitch");
      if (!hadPreview) element.classList.remove("runtime-hollow-glitch-preview");
      marked = null;
    }
    function mark() {
      unmark();
      const element = document.querySelector(".hub-hero-date") ?? document.querySelector("h1, .page-title");
      if (!(element instanceof HTMLElement) || element.closest(RUNTIME_THEME_PROTECTED)) return;
      marked = { element, text: element.getAttribute("data-runtime-hollow-text"), glitch: element.classList.contains("runtime-hollow-glitch"), preview: element.classList.contains("runtime-hollow-glitch-preview") };
      element.setAttribute("data-runtime-hollow-text", element.textContent?.trim() ?? "");
      element.classList.add("runtime-hollow-glitch");
      if (preview) element.classList.add("runtime-hollow-glitch-preview");
    }
    function arm() {
      if (!active || paused()) return;
      timer = window.setTimeout(() => {
        if (!paused()) {
          mark();
          if (!preview) clear = window.setTimeout(unmark, 560);
        }
        if (!preview || ++attempts < 8) arm();
      }, preview ? 1500 : 32000 + Math.random() * 30000);
    }
    function reset() {
      window.clearTimeout(timer); window.clearTimeout(clear); unmark();
      if (!paused()) arm();
    }
    const settled = () => queueMicrotask(() => { if (active) reset(); });
    document.addEventListener("focusin", reset);
    document.addEventListener("focusout", settled);
    document.addEventListener("visibilitychange", reset);
    arm();
    return () => {
      active = false; window.clearTimeout(timer); window.clearTimeout(clear); unmark();
      document.removeEventListener("focusin", reset);
      document.removeEventListener("focusout", settled);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [theme.hostDecorations, interaction, motion, preview]);

  if (!interaction || !theme.hostDecorations?.hoverCrack) return null;
  return <div ref={fracture} data-runtime-theme-decoration aria-hidden="true" className="runtime-hollow-fracture"><span /></div>;
}
