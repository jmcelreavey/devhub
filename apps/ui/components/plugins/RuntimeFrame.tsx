"use client";

import { useEffect, useRef, useState } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { slotActionSchema, type SlotAction } from "../../../../packages/shared/ui-lib/plugins/slot-contract";
import type { RuntimeSlot } from "../../../../packages/shared/ui-lib/plugins/runtime-contract";
import type { PluginStreamEvent } from "@contracts/plugin-runtime";
import { PageActionError } from "../../../../packages/shared/ui-lib/plugins/runtime-page-contract";

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'">`;
const ESCAPE_BRIDGE = `<script>addEventListener("keydown",event=>{if(event.key==="Escape")parent.postMessage({type:"devhub:close"},"*")},true)</script>`;
interface PendingConfirmation { message: string; resolve: (accepted: boolean) => void }
export type RuntimeFrameRequest = (action: SlotAction, signal: AbortSignal, emit: (event: PluginStreamEvent) => void) => Promise<unknown>;

/** Opaque-origin views can only ask for reviewed routes. Context stays in the host. */
export function RuntimeFrame({ html, title, routes, request, hostRequest, onClose, className = "min-h-80" }: {
  html: string; title: string; routes: RuntimeSlot["routes"]; request: RuntimeFrameRequest; onClose?: () => void; className?: string;
  hostRequest?: (action: unknown, signal: AbortSignal) => Promise<unknown>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const stop = useRef<() => void>(() => {});
  const [running, setRunning] = useState(0);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  useEffect(() => {
    let active = true;
    let pending: PendingConfirmation | null = null;
    const requests = new Map<string, AbortController>();
    stop.current = () => { for (const call of requests.values()) call.abort(); };
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      const data = event.data;
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
  }, [request, hostRequest, routes]);

  return <>
    {/* Allow submit handlers to run; form-action 'none' still blocks native submissions. */}
    <iframe ref={frame} title={title} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" srcDoc={CSP + ESCAPE_BRIDGE + html} className={`w-full border-0 rounded ${className}`} />
    {running > 0 && !confirmation ? <div className="flex items-center gap-3 text-xs text-text-muted" role="status">Plugin action running<button type="button" className="btn btn-ghost" onClick={() => stop.current()}>Stop</button></div> : null}
    <ModalShell open={!!confirmation} title={`Confirm ${title}`} onClose={() => confirmation?.resolve(false)}>
      <p className="text-sm whitespace-pre-wrap">{confirmation?.message}</p>
      <p className="text-xs text-text-muted mt-2">This action runs in the plugin. Stopping it after submission may leave a remote action running.</p>
      <div className="flex gap-2 mt-4"><button type="button" className="btn btn-primary" onClick={() => confirmation?.resolve(true)}>Confirm action</button><button type="button" className="btn btn-ghost" onClick={() => confirmation?.resolve(false)}>Cancel</button></div>
    </ModalShell>
  </>;
}
