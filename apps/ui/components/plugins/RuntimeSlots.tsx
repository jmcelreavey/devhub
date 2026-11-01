"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { slotCatalogSchema, type SlotContext, type SlotEntry } from "../../../../packages/shared/ui-lib/plugins/slot-contract";
import { RuntimeFrame, type RuntimeFrameRequest } from "./RuntimeFrame";

export function useRuntimeSlots(location: SlotContext["location"]) {
  const result = useLive<unknown>(`/api/plugins/slots?location=${location}`, { refreshInterval: 0 });
  const parsed = useMemo(() => slotCatalogSchema.safeParse(result.data), [result.data]);
  return { ...result, slots: parsed.success ? parsed.data.slots : [], invalid: result.data !== undefined && !parsed.success };
}

export function RuntimeSlotView({ entry, context, onClose }: { entry: SlotEntry; context: SlotContext; onClose?: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Keys remount this component when either reviewed bytes or the context changes.
  const scope = JSON.stringify({ plugin: entry.plugin, slot: entry.id, revision: entry.revision, context });
  const request = useCallback<RuntimeFrameRequest>(async (action, signal) => {
    const response = await fetch("/api/plugins/slots", { method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ ...JSON.parse(scope), action, confirmed: action.method !== "GET" }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? "Plugin request failed");
    return value.result;
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/plugins/slots", { method: "POST", headers: { "Content-Type": "application/json" }, body: scope, signal: controller.signal });
        const value = await response.json();
        if (!response.ok || typeof value.result !== "string") throw new Error(value.error?.message ?? "Couldn't load this plugin");
        if (!controller.signal.aborted) setHtml(value.result);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't load this plugin"); }
    })();
    return () => controller.abort();
  }, [scope, attempt]);
  if (error) return <FetchError bare message={error} onRetry={() => { setError(null); setHtml(null); setAttempt((n) => n + 1); }} />;
  if (html === null) return <div aria-label={`Loading ${entry.label}`}><SkeletonRows count={3} height={24} /></div>;
  return <RuntimeFrame title={`${entry.label} (${entry.plugin})`} html={html} routes={entry.routes} request={request} onClose={onClose} />;
}

export function RuntimeSlots({ context }: { context: SlotContext }) {
  const catalog = useRuntimeSlots(context.location);
  if (catalog.error || catalog.invalid) return <FetchError message="Couldn't load plugin contributions." onRetry={() => void catalog.mutate()} />;
  if (catalog.isLoading) return <div aria-label="Loading plugin contributions"><SkeletonRows count={1} height={32} /></div>;
  return <>{catalog.slots.map((entry) => <section className="card card-body" key={`${entry.plugin}/${entry.id}/${entry.revision}/${JSON.stringify(context)}`} aria-label={entry.label}>
    <h2 className="text-sm font-semibold mb-3">{entry.label}</h2><RuntimeSlotView entry={entry} context={context} />
  </section>)}</>;
}
