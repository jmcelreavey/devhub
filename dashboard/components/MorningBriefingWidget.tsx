"use client";

import { useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { formatTime } from "@/lib/utils";

interface BriefingResponse {
  ok: boolean;
  text?: string;
  generatedAt?: string;
  cached?: boolean;
  code?: string;
  message?: string;
}

export function MorningBriefingWidget() {
  const { data, isLoading, mutate } = useLive<BriefingResponse>("/api/dashboard/morning-briefing", {
    refreshInterval: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  // AI not configured → no widget at all.
  if (data && data.ok === false && data.code === "not_configured") return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard/morning-briefing?refresh=1");
      const json = (await res.json()) as BriefingResponse;
      await mutate(json, { revalidate: false });
    } catch {
      // keep the previous briefing on failure
    } finally {
      setRefreshing(false);
    }
  };

  const loading = (isLoading && !data) || refreshing;

  return (
    <div className="card" style={{ borderLeft: "3px solid var(--accent)", padding: "10px 14px" }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles size={13} style={{ color: "var(--accent)" }} aria-hidden />
        <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          MORNING BRIEFING
        </span>
        {data?.ok && data.generatedAt && (
          <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
            {formatTime(data.generatedAt)}
            {data.cached ? "" : " · fresh"}
          </span>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="hub-icon-btn ml-auto"
          title="Regenerate briefing"
          aria-label="Regenerate briefing"
        >
          <RefreshCw size={12} aria-hidden className={refreshing ? "animate-spin" : undefined} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          <div className="skeleton" style={{ height: 12, width: "100%" }} />
          <div className="skeleton" style={{ height: 12, width: "85%" }} />
        </div>
      ) : data?.ok ? (
        <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
          {data.text}
        </p>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
          {data?.message ?? "Briefing unavailable."}
        </p>
      )}
    </div>
  );
}
