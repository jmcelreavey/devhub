"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RuntimeContribution } from "@/lib/plugins/runtime-contract";
import { useRuntimeBrand } from "@/components/shell/RuntimeBrandProvider";

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'">`;

export default function RuntimePage({ name }: { name: string }) {
  const branding = useRuntimeBrand();
  const [runtime, setRuntime] = useState<RuntimeContribution | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const endpoint = `/api/plugins/runtime/${encodeURIComponent(name)}`;
  const request = useCallback(async (body: unknown, signal?: AbortSignal) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? "Plugin request failed");
    return value.result;
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error?.message ?? "Couldn’t load this plugin page");
        const definition = value as RuntimeContribution;
        setRuntime(definition);
        const page = selected || definition.pages[0]?.path;
        if (page) {
          const content = await request({ kind: "page", path: page, method: "GET" }, controller.signal);
          if (!controller.signal.aborted) setHtml(content);
        }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t load this plugin page"); }
    })();
    return () => controller.abort();
  }, [endpoint, request, selected, attempt]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const requests = new Map<string, AbortController>();
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      const data = event.data;
      if (!data || typeof data.id !== "string" || data.id.length > 100) return;
      if (data.type === "devhub:cancel") { requests.get(data.id)?.abort(); return; }
      if (data.type !== "devhub:api" || requests.has(data.id)) return;
      const target = event.source as Window;
      const route = runtime?.routes.find((route) => route.path === data.path && route.method === data.method);
      if (!route || requests.size >= 4) {
        target.postMessage({ id: data.id, type: "devhub:result", error: !route ? "This action is not declared by the plugin." : "The plugin is busy. Wait for a running check to finish, then try again." }, "*");
        return;
      }
      const call = new AbortController();
      requests.set(data.id, call);
      const send = (value: Record<string, unknown>) => { if (active) target.postMessage({ id: data.id, ...value }, "*"); };
      try {
        const body = { kind: "api", path: data.path, method: data.method, body: data.body };
        if (!route.stream) send({ type: "devhub:result", result: await request(body, call.signal) });
        else {
          const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: call.signal });
          if (!response.ok || !response.body) throw new Error("Plugin request failed");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = "", complete = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            let end: number;
            while ((end = pending.indexOf("\n")) >= 0) {
              const record = JSON.parse(pending.slice(0, end));
              pending = pending.slice(end + 1);
              if (record.type === "output") send({ type: "devhub:output", text: record.text });
              else if (record.type === "result") { complete = true; send({ type: "devhub:result", result: record.result }); }
              else if (record.type === "error") throw new Error(record.error);
            }
          }
          if (!complete) throw new Error("Plugin output ended before completion");
        }
      } catch {
        send({ type: "devhub:result", error: call.signal.aborted ? "Stopped locally. A submitted remote action may still be running; check its status before retrying." : "Plugin request failed. Check its status before retrying an action." });
      } finally { requests.delete(data.id); }
    };
    window.addEventListener("message", receive);
    return () => { active = false; controller.abort(); for (const call of requests.values()) call.abort(); window.removeEventListener("message", receive); };
  }, [endpoint, request, runtime]);

  return <div className="p-6 space-y-4">
    <div className="flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">{name}</h1><Link href="/plugins" className="btn btn-ghost">Plugins</Link></div>
    {runtime?.branding ? <button type="button" className="btn btn-ghost" onClick={() => branding.select(branding.selected === name ? "" : name)}>{branding.selected === name ? "Restore default branding" : `Use ${runtime.branding.label} branding`}</button> : null}
    {runtime?.pages.length ? <label className="flex items-center gap-3">Page<select className="input" value={selected || runtime.pages[0].path} onChange={(event) => { setHtml(null); setError(null); setSelected(event.target.value); }}>{runtime.pages.map((page) => <option key={page.path} value={page.path}>{page.label}</option>)}</select></label> : null}
    {error ? <div role="alert" className="tone-panel tone-panel--warning"><p>{error}</p><button className="btn btn-ghost mt-3" onClick={() => { setError(null); setHtml(null); setAttempt((n) => n + 1); }}>Retry</button></div>
      : runtime && !runtime.pages.length ? <p>This plugin has no pages.</p>
        : html === null ? <div aria-label="Loading plugin page" className="skeleton h-64 rounded" />
          : <iframe ref={frame} title={`${name} plugin page`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={CSP + html} className="w-full min-h-[70vh] border-0 rounded" />}
  </div>;
}
