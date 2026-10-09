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
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      const data = event.data;
      if (!data || data.type !== "devhub:api" || typeof data.id !== "string" || data.id.length > 100) return;
      if (!runtime?.routes.some((route) => route.path === data.path && route.method === data.method)) return;
      const target = event.source as Window;
      try {
        const result = await request({ kind: "api", path: data.path, method: data.method, body: data.body }, controller.signal);
        if (active) target.postMessage({ type: "devhub:result", id: data.id, result }, "*");
      } catch { if (active) target.postMessage({ type: "devhub:result", id: data.id, error: "Plugin request failed" }, "*"); }
    };
    window.addEventListener("message", receive);
    return () => { active = false; controller.abort(); window.removeEventListener("message", receive); };
  }, [request, runtime]);

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
