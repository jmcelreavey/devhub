"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useGraphiteMotion } from "@/components/graphite/useGraphiteEffects";
import { useTheme } from "@/components/shell/ThemeToggle";
import { advanceBoo, HOLLOW_PREVIEW_KEY, isHollowFaceShot, isHollowPreview } from "@/lib/hollow-theme";
import { effectEnabled, type ThemeEffectPreferences } from "@/lib/theme-effects";
import { isTypingTarget } from "@/lib/typing-target";
import { runtimeThemeAudio } from "@/lib/plugins/runtime-theme-audio";
import { themeSurfaceMessage, themeSurfaceDocument } from "@/lib/plugins/runtime-theme-bridge";
import { runtimeThemeAssetUrl, type PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";
import { runtimeThemeImages } from "@/lib/plugins/runtime-theme-images";
import { observeRuntimeScene, RUNTIME_THEME_BLOCKED, RUNTIME_THEME_EDITING, RUNTIME_THEME_PROTECTED, type RuntimeSceneGeometry } from "@/lib/plugins/runtime-theme-layout";
import { RuntimeThemeDecorations } from "./RuntimeThemeDecorations";
import { registerThemeLifecycle, reportThemeLifecycleFailure, useThemeEffects } from "./useThemeEffects";

const editing = RUNTIME_THEME_EDITING;
const sceneStyle = { position: "fixed" as const, inset: 0, width: "100%", height: "100%", border: 0, background: "transparent", colorScheme: "normal", pointerEvents: "none" as const, zIndex: 18 };
const staticStyles = `
  [data-runtime-theme-static] { overflow: hidden; }
  .runtime-theme-static-layer { position: absolute; pointer-events: none; opacity: var(--runtime-opacity); background: center / 100% 100% no-repeat; }
  .runtime-theme-static-fill { inset: 0; }
  .runtime-theme-static-top { inset: 0 0 auto; height: 18px; }
  .runtime-theme-static-canopy { top: 82px; right: max(12px, env(safe-area-inset-right)); width: clamp(180px, 25vw, 350px); aspect-ratio: 360 / 100; }
  .runtime-theme-static-ornament { right: max(14px, env(safe-area-inset-right)); bottom: max(8px, env(safe-area-inset-bottom)); width: clamp(140px, 17vw, 220px); aspect-ratio: 220 / 160; }
  .runtime-theme-static-mask { position: absolute; inset: 0; pointer-events: none; }
  .runtime-theme-static-room { inset: 0; }
  .runtime-theme-static-room-left, .runtime-theme-static-room-right { top: var(--runtime-room-top); width: 210px; height: 160px; }
  .runtime-theme-static-room-left { left: var(--runtime-room-left); }
  .runtime-theme-static-room-right { right: var(--runtime-room-right); transform: scaleX(-1); }
  @media (max-width: 600px) {
    .runtime-theme-static-layer { opacity: var(--runtime-mobile-opacity); }
    .runtime-theme-static-canopy { top: 118px; width: 180px; }
    .runtime-theme-static-ornament { width: 132px; }
  }
  @media (forced-colors: active), print { [data-runtime-theme-static] { display: none; } }
`;
function sceneLayerStyle(theme: PublicRuntimeTheme) { return { ...sceneStyle, zIndex: theme.readableScene ? 35 : theme.layer === "background" ? 0 : sceneStyle.zIndex }; }
function maskStyle(mask: string): CSSProperties { return { maskImage: mask, WebkitMaskImage: mask, maskMode: "alpha", maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }; }
function subscribeVisibility(callback: () => void) { document.addEventListener("visibilitychange", callback); return () => document.removeEventListener("visibilitychange", callback); }
function inUserGesture() {
  const event = window.event;
  return event ? event.isTrusted && ["click", "pointerdown", "keydown"].includes(event.type) : Boolean(navigator.userActivation?.isActive);
}

/** A passive scene gets lifecycle signals, coordinates and declared sound IDs only. */
export function RuntimeThemeHost({ theme }: { theme: PublicRuntimeTheme }) {
  const preferences = useThemeEffects(theme.id);
  const maskedScene = Boolean(theme.readableScene || theme.staticLayers?.some(layer => layer.placement === "ornament"));
  const motion = useGraphiteMotion();
  const { resolvedMode } = useTheme();
  const visible = useSyncExternalStore(subscribeVisibility, () => !document.hidden, () => false);
  const audio = useRef<ReturnType<typeof runtimeThemeAudio> | null>(null);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const sceneRoot = useRef<HTMLDivElement>(null);
  const fogRoot = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<RuntimeSceneGeometry | null>(null);
  const [requestedPreview, setRequestedPreview] = useState({ on: false, face: false, rare: false });
  const onAudio = useCallback((id: string, action: "play" | "stop") => audio.current?.request(id, action), []);

  useEffect(() => {
    setSceneEpoch(Date.now());
    const controller = runtimeThemeAudio(theme, () => reportThemeLifecycleFailure(theme.id, new Error("Theme audio could not start")));
    audio.current = controller;
    const gesture = (event: Event) => controller.gesture(event);
    window.addEventListener("pointerdown", gesture, { capture: true });
    window.addEventListener("keydown", gesture, { capture: true });
    const unregister = registerThemeLifecycle(theme.id, (next, patch) => controller.configure(next, !window.matchMedia("(prefers-reduced-motion: reduce)").matches && document.body.dataset.motion !== "off", !document.hidden, (patch.sound === true || patch.master === true) && inUserGesture()));
    return () => { unregister(); controller.dispose(); audio.current = null; window.removeEventListener("pointerdown", gesture, true); window.removeEventListener("keydown", gesture, true); };
  }, [theme]);
  useEffect(() => { audio.current?.configure(preferences, motion, visible); }, [preferences, motion, visible]);
  useEffect(() => {
    if (!theme.readableScene && !theme.hostDecorations) return;
    function refresh() {
      let stored: string | null = null;
      try { stored = localStorage.getItem(HOLLOW_PREVIEW_KEY); } catch { stored = null; }
      const search = window.location.search;
      setRequestedPreview({ on: isHollowPreview(search, stored), face: isHollowFaceShot(search), rare: new URLSearchParams(search).get("hollowRare") === "1" });
    }
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("popstate", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("popstate", refresh); };
  }, [theme.readableScene, theme.hostDecorations]);
  useEffect(() => {
    if (!maskedScene || !visible || !preferences.master) return;
    return observeRuntimeScene(next => {
      const root = sceneRoot.current;
      if (root) {
        root.style.visibility = next ? "visible" : "hidden";
        root.style.maskImage = next?.sceneMask ?? "none";
        root.style.webkitMaskImage = next?.sceneMask ?? "none";
      }
      const fog = fogRoot.current;
      if (fog) {
        fog.style.visibility = next ? "visible" : "hidden";
        fog.style.maskImage = next?.mistMask ?? "none";
        fog.style.webkitMaskImage = next?.mistMask ?? "none";
      }
      setGeometry(next);
    });
  }, [maskedScene, theme.revision, visible, preferences.master]);
  useEffect(() => {
    if (!theme.logo) return;
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = theme.logo.path.endsWith(".png") ? "image/png" : "image/webp";
    link.href = runtimeThemeAssetUrl(theme, "logo");
    document.head.appendChild(link);
    return () => link.remove();
  }, [theme]);
  if (!visible || !preferences.master) return null;
  const preview = {
    on: motion && requestedPreview.on,
    face: motion && requestedPreview.face && effectEnabled(theme.id, preferences, "jumpScares", motion),
    rare: motion && requestedPreview.rare && effectEnabled(theme.id, preferences, "rareEvents", motion),
  };
  const room = geometry?.layout.room;
  const roomStyles = room ? { "--runtime-room-left": `${room[0] + 8}px`, "--runtime-room-top": `${room[1] + 8}px`, "--runtime-room-right": `${innerWidth - room[2] + 8}px` } as CSSProperties : {};
  let scene = null;
  if ((motion || theme.staticSurface) && theme.surface) {
    const props = { theme, preferences, geometry, preview, onAudio, motion, sceneEpoch };
    scene = <>
      {theme.fogLayer ? <div ref={fogRoot} data-runtime-theme-fog style={{ ...sceneLayerStyle(theme), ...(geometry ? maskStyle(geometry.mistMask) : { visibility: "hidden" }) }}><RuntimeThemeScene {...props} layer="fog" /></div> : null}
      <RuntimeThemeScene {...props} layer="scene" />
    </>;
  } else if (!motion && theme.staticLayers) {
    scene = <div data-runtime-theme-static aria-hidden="true" style={{ ...sceneLayerStyle(theme), ...roomStyles }}>
      <style>{staticStyles}</style>
      {theme.staticLayers.filter(layer => effectEnabled(theme.id, preferences, layer.effect, false)).map(layer => {
        const image = <div data-runtime-static-layer={layer.id} className={`runtime-theme-static-layer runtime-theme-static-${layer.placement}`}
          style={{ backgroundImage: `url("${runtimeThemeAssetUrl(theme, `static:${layer.id}${resolvedMode === "light" ? ":light" : ""}`)}")`, "--runtime-opacity": layer.opacity, "--runtime-mobile-opacity": layer.mobileOpacity } as CSSProperties} />;
        return layer.placement.startsWith("room")
          ? <div key={layer.id} className="runtime-theme-static-mask" style={geometry ? maskStyle(layer.placement === "room" ? geometry.mistMask : geometry.roomMask) : { visibility: "hidden" }}>{image}</div>
          : <div key={layer.id}>{image}</div>;
      })}
    </div>;
  } else if (!motion && theme.staticImage) {
    scene = <div data-runtime-theme-static aria-hidden="true" style={{ ...sceneLayerStyle(theme), background: `url("${runtimeThemeAssetUrl(theme, "static")}") center / cover no-repeat` }} />;
  }
  return <>
    {theme.hostDecorations ? <RuntimeThemeDecorations theme={theme} interaction={effectEnabled(theme.id, preferences, "interaction", motion)} motion={motion} preview={preview.on} /> : null}
    {maskedScene ? <div ref={sceneRoot} data-runtime-theme-root aria-hidden="true" style={{ ...sceneLayerStyle(theme), ...(geometry ? maskStyle(geometry.sceneMask) : { visibility: "hidden" }) }}>{scene}</div> : scene}
  </>;
}

interface RuntimeThemeSceneProps {
  theme: PublicRuntimeTheme;
  preferences: ThemeEffectPreferences;
  geometry: RuntimeSceneGeometry | null;
  preview: { on: boolean; face: boolean; rare: boolean };
  onAudio: (id: string, action: "play" | "stop") => void;
  motion: boolean;
  layer: "scene" | "fog";
  sceneEpoch: number;
}

function RuntimeThemeScene({ theme, preferences, geometry, preview, onAudio, motion, layer, sceneEpoch }: RuntimeThemeSceneProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [surface, setSurface] = useState<{ html: string; nonce: string; images: Record<string, string> } | null>(null);
  const stateRef = useRef<() => void>(() => {});
  const current = useRef({ preferences, geometry });
  useEffect(() => { current.current = { preferences, geometry }; }, [preferences, geometry]);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    async function load() {
      try {
        const response = await fetch(runtimeThemeAssetUrl(theme, "surface"), { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Theme surface unavailable");
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || !("html" in result) || typeof result.html !== "string" || result.html.length > 256 * 1024) throw new Error("Invalid theme surface");
        const images = await runtimeThemeImages(theme, controller.signal);
        if (!controller.signal.aborted) setSurface({ html: result.html, nonce: crypto.randomUUID(), images });
      } catch { if (!cancelled) reportThemeLifecycleFailure(theme.id, new Error("Theme surface could not load")); }
      finally { window.clearTimeout(timeout); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [theme]);

  const send = useCallback((type: string, payload: object) => {
    if (surface) frame.current?.contentWindow?.postMessage({ type, nonce: surface.nonce, ...payload }, "*");
  }, [surface]);
  function state(includeImages = false) {
    send("devhub:theme-state", { state: {
      preset: theme.id, mode: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      preferences: Object.fromEntries((theme.effects?.effects ?? []).map(effect => [effect.id, effectEnabled(theme.id, preferences, effect.id, motion)])),
      motion, layer, sceneEpoch, visible: true, paused: Boolean(document.activeElement?.closest(editing)),
      viewport: { width: innerWidth, height: innerHeight },
      ...(theme.readableScene ? { layout: geometry?.layout ?? null, preview, soundActive: false } : {}),
      ...(includeImages ? { assets: surface?.images ?? {} } : {}),
    } });
  }
  useEffect(() => {
    stateRef.current = state;
    state();
    if (theme.readableScene && !geometry) send("devhub:theme-event", { event: { kind: "pointer", active: false } });
  });
  useEffect(() => {
    if (!surface) return;
    const message = (event: MessageEvent) => {
      const parsed = themeSurfaceMessage(event, frame.current?.contentWindow ?? null, surface.nonce, theme);
      if (parsed?.type === "devhub:theme-audio" && layer === "scene" && motion) onAudio(parsed.id, parsed.action);
      if (parsed?.type === "devhub:theme-error") reportThemeLifecycleFailure(theme.id, new Error("Theme effect stopped"));
    };
    if (layer === "fog" || !motion) {
      window.addEventListener("message", message);
      return () => window.removeEventListener("message", message);
    }
    let lastPointer = 0;
    let word = "", index = 0;
    let lastKey = 0;
    let pointerActive = false, lastExit = 0, active = true;
    const hidePointer = () => { if (pointerActive) { pointerActive = false; send("devhub:theme-event", { event: { kind: "pointer", active: false } }); } };
    const coordinate = (value: number, maximum: number) => Math.max(0, Math.min(maximum, Math.round(value / 8) * 8));
    const pointer = (event: PointerEvent) => {
      if (!event.isTrusted || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      if (theme.readableScene) {
        const target = event.target instanceof Element ? event.target : null;
        const effects = theme.pointerEffects ?? ["cursor"];
        const blocked = !current.current.geometry || Boolean(document.activeElement?.closest(editing)) || !effects.some(id => effectEnabled(theme.id, current.current.preferences, id, true))
          || Boolean(target?.closest(theme.pointerEffects ? RUNTIME_THEME_PROTECTED : RUNTIME_THEME_BLOCKED))
          || (!theme.pointerEffects && Boolean(target && [...target.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim())));
        if (blocked || (event.pointerType && event.pointerType !== "mouse")) { hidePointer(); return; }
      }
      if (performance.now() - lastPointer < 32) return;
      lastPointer = performance.now();
      const blocked = event.target instanceof Element && Boolean(event.target.closest(editing));
      pointerActive = !blocked;
      const target = event.target instanceof Element ? event.target : null;
      const overContent = Boolean(target?.closest(RUNTIME_THEME_BLOCKED)) || Boolean(target && [...target.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim()));
      send("devhub:theme-event", { event: blocked ? { kind: "pointer", active: false } : { kind: "pointer", active: true, x: theme.readableScene ? coordinate(event.clientX, innerWidth) : Math.max(0, Math.min(innerWidth, event.clientX)), y: theme.readableScene ? coordinate(event.clientY, innerHeight) : Math.max(0, Math.min(innerHeight, event.clientY)), ...(theme.pointerEffects ? { overContent } : {}) } });
    };
    const cardExit = (event: PointerEvent) => {
      if (!theme.readableScene || !event.isTrusted || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) || !current.current.geometry || document.activeElement?.closest(editing)
        || !effectEnabled(theme.id, current.current.preferences, "cursor", true) || !(event.target instanceof Element)) return;
      const card = event.target.closest(".hub-card, .card, .task-row, [role='row']");
      if (!card || event.target.closest(RUNTIME_THEME_PROTECTED) || card.closest(RUNTIME_THEME_PROTECTED) || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) || performance.now() - lastExit < 32) return;
      lastExit = performance.now();
      send("devhub:theme-event", { event: { kind: "card-exit", x: coordinate(event.clientX, innerWidth), y: coordinate(event.clientY, innerHeight) } });
    };
    const key = (event: KeyboardEvent) => {
      hidePointer();
      if (!event.isTrusted || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || document.activeElement?.closest(editing)) return;
      if (theme.readableScene) {
        if (event.key.length !== 1 || !effectEnabled(theme.id, current.current.preferences, "jumpScares", true)) return;
        const next = advanceBoo(index, event.key);
        index = next === "trigger" ? 0 : next;
        if (next === "trigger") send("devhub:theme-event", { event: { kind: "boo" } });
        return;
      }
      const now = performance.now();
      word = (now - lastKey > 1000 ? "" : word) + event.key.toLowerCase();
      word = word.slice(-3); lastKey = now;
      if (word === "boo") { send("devhub:theme-event", { event: { kind: "boo" } }); word = ""; }
    };
    const celebrate = (event: Event) => {
      if (!(event instanceof CustomEvent) || !["task", "merge"].includes(event.detail)) return;
      send("devhub:theme-event", { event: { kind: "celebrate", action: event.detail } });
    };
    const changed = () => queueMicrotask(() => { if (active) stateRef.current(); });
    window.addEventListener("message", message);
    window.addEventListener("pointermove", pointer, { passive: true });
    window.addEventListener("pointerout", cardExit, { passive: true });
    window.addEventListener("keydown", key);
    window.addEventListener("resize", changed);
    window.addEventListener("devhub:graphite-celebrate", celebrate);
    for (const event of ["scroll", "blur", "dragstart", "pointerleave"]) window.addEventListener(event, hidePointer, true);
    document.addEventListener("focusin", hidePointer);
    document.addEventListener("focusin", changed);
    document.addEventListener("focusout", changed);
    return () => {
      active = false; window.removeEventListener("message", message); window.removeEventListener("pointermove", pointer); window.removeEventListener("pointerout", cardExit); window.removeEventListener("keydown", key); window.removeEventListener("resize", changed); window.removeEventListener("devhub:graphite-celebrate", celebrate);
      for (const event of ["scroll", "blur", "dragstart", "pointerleave"]) window.removeEventListener(event, hidePointer, true);
      document.removeEventListener("focusin", hidePointer); document.removeEventListener("focusin", changed); document.removeEventListener("focusout", changed);
    };
  }, [surface, theme, onAudio, send, motion, layer]);
  if (!surface) return null;
  return <iframe ref={frame} data-runtime-theme={theme.id} title={`${theme.label} effects`} sandbox="allow-scripts" allow="autoplay 'none'; camera 'none'; microphone 'none'; geolocation 'none'" referrerPolicy="no-referrer" inert tabIndex={-1} aria-hidden="true" style={sceneLayerStyle(theme)} srcDoc={themeSurfaceDocument(surface.html, surface.nonce, !motion)} onLoad={() => state(true)} />;
}
