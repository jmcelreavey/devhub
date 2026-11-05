"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/lib/navigation";
import { runtimePageHref } from "../../../../../../packages/shared/ui-lib/navigation/nav";
import type { RuntimeContribution } from "../../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { EmptyState } from "@/components/ui/EmptyState";
import { RuntimeFrame, type RuntimeFrameRequest } from "@/components/plugins/RuntimeFrame";
import { useRuntimePageActions } from "@/components/plugins/useRuntimePageActions";
import { useLive } from "@/lib/hooks/use-fetch";
import { runtimePageQuery } from "@/lib/plugins/runtime-page-query";

export default function RuntimePage({ name, initialPage = "", initialSearch = "" }: { name: string; initialPage?: string; initialSearch?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return <div className="page-wrapper space-y-4">
    {runtime && runtime.pages.length > 1 ? <nav aria-label={`${name} pages`} className="flex gap-4 overflow-x-auto border-b border-border">
      {runtime.pages.map(item => <Link key={item.path} href={runtimePageHref(name, item.path)} aria-current={page === item.path ? "page" : undefined} className={`shrink-0 border-b-2 px-1 py-2 text-sm ${page === item.path ? "border-accent font-medium text-text" : "border-transparent text-text-muted hover:text-text"}`}>{item.label}</Link>)}
    </nav> : null}
    {error || catalogError ? <FetchError message={error || catalogError?.message || "Couldn’t load this page"} onRetry={() => { setError(null); setHtml(null); void mutate(); setAttempt(n => n + 1); }} />
      : runtime && !runtime.pages.length ? <EmptyState title="No pages available" subtitle="This plugin has no pages." />
        : html === null ? <div aria-label="Loading page"><SkeletonRows count={6} /></div>
          : runtime ? <RuntimeFrame key={`${page}:${revision}`} title={runtime.pages.find(item => item.path === page)?.label ?? name} html={html} routes={runtime.routes} request={frameRequest} hostRequest={host.request} autoHeight /> : null}
    {host.dialog}
  </div>;
}
