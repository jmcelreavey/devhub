"use client";

import { useEffect, useRef, useState } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { slotActionSchema, type SlotAction } from "../../../../packages/shared/ui-lib/plugins/slot-contract";
import type { RuntimeSlot } from "../../../../packages/shared/ui-lib/plugins/runtime-contract";
import type { PluginStreamEvent } from "@contracts/plugin-runtime";
import { PageActionError } from "../../../../packages/shared/ui-lib/plugins/runtime-page-contract";
import { themePaletteTokens } from "../../../../packages/shared/ui-lib/plugins/theme-palette-schema";
import primitives from "@/app/primitives.css?inline";
import frameStyles from "./runtime-frame.css?inline";

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'">`;
const ESCAPE_BRIDGE = `<script>addEventListener("keydown",event=>{if(event.key==="Escape")parent.postMessage({type:"devhub:close"},"*")},true)</script>`;
const THEME_BRIDGE = `<script>addEventListener("message",event=>{if(event.source!==parent||event.data?.type!=="devhub:theme")return;const root=document.documentElement;root.dataset.theme=event.data.mode;root.style.colorScheme=event.data.mode;if(document.body)document.body.dataset.motion=event.data.motion;for(const [name,value] of Object.entries(event.data.tokens))root.style.setProperty(name,value);})</script>`;
const HEIGHT_BRIDGE = `<script>addEventListener("DOMContentLoaded",()=>{let scheduled=false,last=0;const report=()=>{scheduled=false;const height=Math.ceil(document.body.getBoundingClientRect().height);if(height!==last){last=height;parent.postMessage({type:"devhub:height",height},"*")}};new ResizeObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(report)}}).observe(document.body);report();document.addEventListener("click",event=>{const link=event.target.closest?.('a[href^="#"]');if(!link)return;const target=document.getElementById(link.getAttribute("href").slice(1));if(target){event.preventDefault();target.scrollIntoView({block:"start"})}})})</script>`;
const presentationTokens = ["radius", "radius-sm", "radius-lg", "font-sans", "font-display", "font-mono", "page-max", "space-1", "space-2", "space-3", "space-4", "space-5", "space-6", "space-8", "space-10", "dur-quick", "dur-fast", "ease-swift", "focus-ring-color", "focus-ring-width", "focus-ring-offset"];
interface PendingConfirmation { message: string; resolve: (accepted: boolean) => void }
export type RuntimeFrameRequest = (action: SlotAction, signal: AbortSignal, emit: (event: PluginStreamEvent) => void) => Promise<unknown>;

/** Opaque-origin views can only ask for reviewed routes. Context stays in the host. */
export function RuntimeFrame({ html, title, routes, request, hostRequest, onClose, className = "min-h-80", autoHeight = false }: {
  html: string; title: string; routes: RuntimeSlot["routes"]; request: RuntimeFrameRequest; onClose?: () => void; className?: string;
  hostRequest?: (action: unknown, signal: AbortSignal) => Promise<unknown>;
  autoHeight?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const stop = useRef<() => void>(() => {});
  const [running, setRunning] = useState(0);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [height, setHeight] = useState(320);
  const sendTheme = () => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const tokens = Object.fromEntries([...themePaletteTokens, ...presentationTokens].map(token => [`--${token}`, style.getPropertyValue(`--${token}`).trim()]));
    // Older plugin pages use these aliases. Only presentation values cross the sandbox.
    tokens["--muted"] = tokens["--text-muted"];
    tokens["--surface"] = tokens["--bg-surface"];
    frame.current?.contentWindow?.postMessage({ type: "devhub:theme", mode: root.dataset.theme === "light" ? "light" : "dark", motion: document.body.dataset.motion ?? "on", tokens }, "*");
  };
  useEffect(() => {
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-preset", "data-runtime-theme", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-motion"] });
    const palettes = document.querySelector("style[data-runtime-theme-palettes]");
    if (palettes) observer.observe(palettes, { childList: true, characterData: true, subtree: true });
    sendTheme();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let pending: PendingConfirmation | null = null;
    const requests = new Map<string, AbortController>();
    stop.current = () => { for (const call of requests.values()) call.abort(); };
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      const data = event.data;
      if (data?.type === "devhub:height" && autoHeight) {
        if (Number.isSafeInteger(data.height) && data.height >= 0 && data.height <= 100_000) setHeight(Math.max(240, data.height));
        return;
      }
      if (data?.type === "devhub:close") { close.current?.(); return; }
      if (!data || typeof data.id !== "string" || !data.id || data.id.length > 100) return;
      if (data.type === "devhub:cancel") { requests.get(data.id)?.abort(); return; }
      const hostAction = data.type === "devhub:host" && !!hostRequest;
      if ((!hostAction && data.type !== "devhub:api") || requests.has(data.id)) return;
      const parsed = slotActionSchema.safeParse({ path: data.path, method: data.method, ...(data.body === undefined ? {} : { body: data.body }) });
      const route = parsed.success && routes.find((r) => r.path === parsed.data.path && r.method === parsed.data.method);
      const target = event.source as Window;
      const send = (value: Record<string, unknown>) => { if (active) target.postMessage({ id: data.id, ...value }, "*"); };
      if ((!hostAction && (!parsed.success || !route)) || requests.size >= 4 || pending) {
        send({ type: "devhub:result", error: !route ? "This action is not declared by the plugin." : "Finish the current action before starting another." });
        return;
      }
      const call = new AbortController();
      requests.set(data.id, call);
      setRunning(requests.size);
      try {
        if (!hostAction && route && route.confirmation) {
          const accepted = await new Promise<boolean>((resolve) => {
            pending = { message: route.confirmation!, resolve };
            setConfirmation(pending);
            call.signal.addEventListener("abort", () => resolve(false), { once: true });
          });
          pending = null;
          if (active) setConfirmation(null);
          if (!accepted || call.signal.aborted || !active) {
            send({ type: "devhub:result", error: "Cancelled. No action was submitted." });
            return;
          }
        }
        const result = hostAction ? await hostRequest!(data.action, call.signal) : await request(parsed.data!, call.signal, (event) => send({ ...event, type: event.type === "output" ? "devhub:output" : "devhub:progress" }));
        send({ type: "devhub:result", result });
      } catch (error) {
        send({ type: "devhub:result", error: call.signal.aborted ? "Stopped locally. A submitted remote action may still be running; check its status before retrying." : hostAction && error instanceof PageActionError ? error.message : hostAction ? "Browser action failed or was cancelled. Check Plugins or Notes before retrying a write." : "Plugin request failed. Check its status before retrying an action." });
      } finally { requests.delete(data.id); if (active) setRunning(requests.size); }
    };
    window.addEventListener("message", receive);
    return () => { active = false; pending?.resolve(false); for (const call of requests.values()) call.abort(); window.removeEventListener("message", receive); };
  }, [request, hostRequest, routes, autoHeight]);

  return <>
    {/* Allow submit handlers to run; form-action 'none' still blocks native submissions. */}
    <iframe ref={frame} title={title} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" onLoad={sendTheme} srcDoc={CSP + `<style>${frameStyles}\n${primitives}${autoHeight ? "\nbody { background: transparent; }" : ""}</style>` + ESCAPE_BRIDGE + THEME_BRIDGE + (autoHeight ? HEIGHT_BRIDGE : "") + html} className={`block w-full border-0 ${className}`} style={autoHeight ? { height } : undefined} />
    {running > 0 && !confirmation ? <div className="flex items-center gap-3 text-xs text-text-muted" role="status">Plugin action running<button type="button" className="btn btn-ghost" onClick={() => stop.current()}>Stop</button></div> : null}
    <ModalShell open={!!confirmation} title={`Confirm ${title}`} onClose={() => confirmation?.resolve(false)}>
      <p className="text-sm whitespace-pre-wrap">{confirmation?.message}</p>
      <p className="text-xs text-text-muted mt-2">This action runs in the plugin. Stopping it after submission may leave a remote action running.</p>
      <div className="flex gap-2 mt-4"><button type="button" className="btn btn-primary" onClick={() => confirmation?.resolve(true)}>Confirm action</button><button type="button" className="btn btn-ghost" onClick={() => confirmation?.resolve(false)}>Cancel</button></div>
    </ModalShell>
  </>;
}
