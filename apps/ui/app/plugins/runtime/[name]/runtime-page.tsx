"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";
import { runtimePageHref } from "../../../../../../packages/shared/ui-lib/navigation/nav";
import type { RuntimeContribution } from "../../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { useRuntimeBrand } from "@/components/shell/RuntimeBrandProvider";
import { RuntimeFrame, type RuntimeFrameRequest } from "@/components/plugins/RuntimeFrame";
import { useRuntimePageActions } from "@/components/plugins/useRuntimePageActions";
import { useLive } from "@/lib/hooks/use-fetch";
import { runtimePageQuery } from "@/lib/plugins/runtime-page-query";

export default function RuntimePage({ name, initialPage = "", initialSearch = "" }: { name: string; initialPage?: string; initialSearch?: string }) {
  const branding = useRuntimeBrand();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const endpoint = `/api/plugins/runtime/${encodeURIComponent(name)}`;
  const { data: catalog, error: catalogError, mutate } = useLive<{ runtime: RuntimeContribution; revision: string }>(`${endpoint}?view=page`, { refreshInterval: 0 });
  const runtime = catalogError ? undefined : catalog?.runtime;
  const revision = catalog?.revision ?? "";
  const page = initialPage || runtime?.pages[0]?.path || "";
  const host = useRuntimePageActions(name, page, revision);
  const request = useCallback(async (body: unknown, signal?: AbortSignal) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(body as object), revision }), signal });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? "Plugin request failed");
    return value.result;
  }, [endpoint, revision]);

  useEffect(() => {
    const controller = new AbortController();
    if (!runtime) return;
    void (async () => {
      try {
        setHtml(null);
        setError(null);
        if (page) {
          const query = runtimePageQuery(initialSearch);
          if (!query) throw new Error("Plugin page query is too long.");
          const content = await request({ kind: "page", path: page, method: "GET", ...(Object.keys(query).length ? { body: { query } } : {}) }, controller.signal);
          if (!controller.signal.aborted) setHtml(content);
        }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t load this plugin page"); }
    })();
    return () => controller.abort();
  }, [runtime, request, page, initialSearch, attempt]);

  const frameRequest = useCallback<RuntimeFrameRequest>(async (action, signal, emit) => {
    const body = { kind: "api", ...action, revision };
    const route = runtime?.routes.find((route) => route.path === action.path && route.method === action.method);
    if (!route?.stream) return request(body, signal);
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok || !response.body) throw new Error("Plugin request failed");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "", complete = false;
    let result: unknown;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const record = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (record.type === "output" || record.type === "progress") emit(record);
        else if (record.type === "result") { complete = true; result = record.result; }
        else if (record.type === "error") throw new Error(record.error);
      }
    }
    if (!complete) throw new Error("Plugin output ended before completion");
    return result;
  }, [endpoint, request, runtime, revision]);

  return <div className="p-6 space-y-4">
    <div className="flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">{name}</h1><Link href="/plugins" className="btn btn-ghost">Plugins</Link></div>
    {runtime?.branding ? <button type="button" className="btn btn-ghost" onClick={() => branding.select(branding.selected === name ? "" : name)}>{branding.selected === name ? "Restore default branding" : `Use ${runtime.branding.label} branding`}</button> : null}
    {runtime?.pages.length ? <label className="flex items-center gap-3">Page<select className="input" value={page} onChange={(event) => router.push(runtimePageHref(name, event.target.value))}>{runtime.pages.map((page) => <option key={page.path} value={page.path}>{page.label}</option>)}</select></label> : null}
    {error || catalogError ? <div role="alert" className="tone-panel tone-panel--warning"><p>{error || catalogError?.message}</p><button className="btn btn-ghost mt-3" onClick={() => { setError(null); setHtml(null); void mutate(); setAttempt((n) => n + 1); }}>Retry</button></div>
      : runtime && !runtime.pages.length ? <p>This plugin has no pages.</p>
        : html === null ? <div aria-label="Loading plugin page" className="skeleton h-64 rounded" />
          : runtime ? <RuntimeFrame key={`${page}:${revision}`} title={`${name} plugin page`} html={html} routes={runtime.routes} request={frameRequest} hostRequest={host.request} className="min-h-[70vh]" /> : null}
    {host.dialog}
  </div>;
}
