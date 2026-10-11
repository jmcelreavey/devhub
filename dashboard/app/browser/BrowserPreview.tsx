"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelVisible } from "@/lib/hooks/panel-visibility";
import styles from "./browser.module.css";

interface Frame { id: string; data: string; width: number; height: number }
interface Props { sessionId: string; tabId?: string; enabled: boolean; human: boolean; takeControl: () => Promise<unknown> }
export function BrowserPreview({ sessionId, tabId, enabled, human, takeControl }: Props) {
  const visible = usePanelVisible();
  const [frame, setFrame] = useState<Frame>();
  const [failure, setFailure] = useState("");
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const streamId = useRef("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const generation = useRef(0);
  const composing = useRef(false);
  const currentFrame = useRef(frame);
  currentFrame.current = frame;
  const humanRef = useRef(human);
  humanRef.current = human;
  const send = useCallback((input: Record<string, unknown>) => {
    if (!humanRef.current || !streamId.current || queued.current >= 50) return;
    const id = streamId.current, revision = generation.current;
    queued.current++;
    queue.current = queue.current.then(async () => {
      if (revision !== generation.current || !humanRef.current) return;
      const response = await fetch("/api/browser/surface", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "input", sessionId, streamId: id, input }) });
      if (!response.ok) throw new Error("Input stopped. The page or control changed; check the page before trying again.");
    }).catch((cause: unknown) => { generation.current++; setFailure(cause instanceof Error ? cause.message : "Input failed."); })
      .finally(() => { queued.current--; });
  }, [sessionId]);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!enabled || !visible || hidden) return;
    const controller = new AbortController();
    const reset = setTimeout(() => { setFrame(undefined); setFailure(""); setConnected(false); }, 0);
    const inputGeneration = generation;
    inputGeneration.current++; streamId.current = "";
    const connect = async () => {
      try {
        const response = await fetch("/api/browser/surface", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stream", sessionId }), signal: controller.signal });
        clearTimeout(reset);
        if (!response.ok || !response.body) throw new Error("Live view could not connect. Check Chrome, then reconnect.");
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let pending = "";
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let boundary;
          while ((boundary = pending.indexOf("\n\n")) >= 0) {
            const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
            const kind = event.match(/^event: (.+)/)?.[1];
            const data = JSON.parse(event.slice(event.indexOf("data: ") + 6));
            if (kind === "ready") { streamId.current = data.id; setConnected(true); }
            if (kind === "frame") setFrame(data as Frame);
            if (kind === "failure") throw new Error(data.message);
          }
        }
        if (!controller.signal.aborted) throw new Error("Live view disconnected. Reconnect here, or continue in Chrome.");
      } catch (cause) { clearTimeout(reset); if (!controller.signal.aborted) { setFrame(undefined); setConnected(false); streamId.current = ""; setFailure(cause instanceof Error ? cause.message : "Live view disconnected."); } }
    };
    void connect();
    return () => { clearTimeout(reset); inputGeneration.current++; streamId.current = ""; controller.abort(); };
  }, [sessionId, tabId, enabled, visible, hidden, attempt]);
  useEffect(() => {
    if (!connected || !human || !area.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const resize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const bounds = area.current?.getBoundingClientRect();
        if (bounds) send({ kind: "resize", width: Math.round(Math.max(320, Math.min(1920, bounds.width))), height: Math.round(Math.max(240, Math.min(1080, bounds.height))), dpr: Math.min(2, Math.max(1, window.devicePixelRatio)) });
      }, 200);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(area.current); window.addEventListener("resize", resize); resize();
    return () => { observer.disconnect(); clearTimeout(timer); window.removeEventListener("resize", resize); };
  }, [connected, human, send]);
  const point = (clientX: number, clientY: number) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect || !frame) return null;
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    const x = (clientX - rect.left - (rect.width - frame.width * scale) / 2) / scale;
    const y = (clientY - rect.top - (rect.height - frame.height * scale) / 2) / scale;
    return x >= 0 && y >= 0 && x < frame.width && y < frame.height ? { x, y } : null;
  };
  useEffect(() => {
    const element = area.current;
    if (!element || !enabled || !visible || hidden) return;
    const wheel = (event: WheelEvent) => {
      if (!humanRef.current) return;
      const image = currentFrame.current;
      if (!image) return;
      const rect = element.getBoundingClientRect();
      const scale = Math.min(rect.width / image.width, rect.height / image.height);
      const x = (event.clientX - rect.left - (rect.width - image.width * scale) / 2) / scale;
      const y = (event.clientY - rect.top - (rect.height - image.height * scale) / 2) / scale;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? image.height : 1;
      send({ kind: "scroll", x, y, deltaX: Math.max(-4000, Math.min(4000, event.deltaX * unit)), deltaY: Math.max(-4000, Math.min(4000, event.deltaY * unit)) });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [enabled, visible, hidden, send]);
  const key = (event: React.KeyboardEvent) => {
    if (!human || composing.current || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); send({ kind: "key", key: "Escape" }); area.current?.blur(); textInput.current?.blur(); return; }
    if (event.ctrlKey || event.metaKey) {
      const letter = event.key.toLowerCase();
      if (["a", "z"].includes(letter)) { event.preventDefault(); send({ kind: "key", key: "ControlOrMeta+" + (event.shiftKey && letter === "z" ? "Shift+" : "") + letter.toUpperCase() }); }
      return;
    }
    if (["Enter", "Tab", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault(); send({ kind: "key", key: event.key === "Tab" && event.shiftKey ? "Shift+Tab" : event.key });
    } else if (event.currentTarget === area.current && event.key.length === 1) {
      event.preventDefault(); send({ kind: "text", text: event.key });
    }
  };
  if (!enabled || !visible || hidden) return null;
  return <section className={styles.preview} aria-label="Live browser">
    <div className={styles.streamHeader}><strong>{human ? "You control this page" : "Watching the agent"}</strong><span className={styles.meta}>{connected ? "Live · images stay in memory" : failure ? "Disconnected" : "Connecting"}</span></div>
    {failure && <div role="alert" className="tone-panel tone-panel--warning"><p>{failure}</p><button className="btn btn-ghost" onClick={() => { setFailure(""); setAttempt((value) => value + 1); }}>Reconnect live view</button></div>}
    <div ref={area} className={styles.frame} tabIndex={0} role="application" aria-label={human ? "Browser page. Click to interact, type to enter text. Escape releases keyboard focus." : "Browser preview. Click or press Enter to take control."}
      onKeyDown={(event) => { if (!human && ["Enter", " "].includes(event.key)) { event.preventDefault(); void takeControl(); } else key(event); }}
      onClick={(event) => {
        if (!human) { void takeControl(); return; }
        const position = point(event.clientX, event.clientY);
        if (position) { send({ kind: "click", ...position, count: 1 }); textInput.current?.focus({ preventScroll: true }); }
      }}
      onContextMenu={(event) => { event.preventDefault(); if (human) { const position = point(event.clientX, event.clientY); if (position) send({ kind: "click", ...position, button: "right" }); } }}
      >
      {frame ? <>{/* The stream must never enter the image optimiser or its disk cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={"data:image/jpeg;base64," + frame.data} alt="Live page in the task browser" draggable={false} />
        {!human && <span className={styles.takeover}>Click to take control</span>}
      </> : failure ? <p>Live view unavailable. Use Reconnect above or Open in Chrome.</p> : <div className="skeleton" style={{ width: "100%", height: "100%" }} aria-label="Connecting live browser" />}
    </div>
    {human && <label className={styles.inputLabel}>Keyboard and IME input
      <textarea ref={textInput} className="input" rows={1} placeholder="Click a field above, then type or paste here" aria-describedby="browser-input-help" onKeyDown={key}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(event) => { composing.current = false; if (event.currentTarget.value) send({ kind: "text", text: event.currentTarget.value }); event.currentTarget.value = ""; }}
        onInput={(event) => { if (!composing.current && event.currentTarget.value) { send({ kind: "text", text: event.currentTarget.value }); event.currentTarget.value = ""; } }} />
    </label>}
    <p id="browser-input-help">{human ? "Text goes to the focused website field. IME composition is sent when committed. Escape releases keyboard focus. Use Chrome for screen readers, drag gestures, clipboard copying or browser-native menus." : "The first click only takes control; it does not click the website. Native Chrome remains available."}</p>
  </section>;
}
