"use client";

import { useState } from "react";
import Link from "next/link";
import { Sun, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import type { DailyBriefing } from "@/lib/morning-briefing";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";
import { DashboardBriefingWeather } from "@/components/DashboardBriefingWeather";

interface BriefingResponse {
  ok: boolean;
  briefing?: DailyBriefing;
  generatedAt?: string;
  cached?: boolean;
  code?: string;
  message?: string;
}

interface MorningBriefingWidgetProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function MorningBriefingWidget({ collapsed = false, onToggle }: MorningBriefingWidgetProps) {
  const { data, isLoading, mutate } = useLive<BriefingResponse>("/api/dashboard/morning-briefing", {
    refreshInterval: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard/morning-briefing?refresh=1", { cache: "no-store" });
      const json = (await res.json()) as BriefingResponse;
      await mutate(json, { revalidate: false });
    } catch {
      // keep the previous briefing on failure
    } finally {
      setRefreshing(false);
    }
  };

  const loading = (isLoading && !data) || refreshing;
  const b = data?.ok ? data.briefing : undefined;

  return (
    <div
      className="card today-grid-drag-handle"
      data-collapsed={collapsed ? "true" : undefined}
      style={{ padding: "var(--space-3) var(--space-3)" }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-2)" }}>
        <Sun size={13} style={{ color: "var(--warning)" }} aria-hidden />
        <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
          Morning briefing
        </span>
        <span className="ml-auto flex min-w-0 items-center gap-2">
          <Link href="/briefing" className="text-xs today-grid-drag-cancel" style={{ color: "var(--accent)" }}>
            View all →
          </Link>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="hub-icon-btn today-grid-drag-cancel"
            title="Refresh weather"
            aria-label="Refresh weather"
          >
            <RefreshCw size={12} aria-hidden className={refreshing ? "animate-spin" : undefined} />
          </button>
          {onToggle ? (
            <TodayCollapseButton collapsed={collapsed} label="Morning briefing" onToggle={onToggle} />
          ) : null}
        </span>
      </div>

      {!collapsed && (
        <>
          {loading ? (
            <div className="space-y-2">
              <div className="skeleton" style={{ height: 88, width: "100%", borderRadius: 12 }} />
            </div>
          ) : !b ? (
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
              {data?.message ?? "Briefing unavailable. Try refreshing."}
            </p>
          ) : (
            <div key={data?.generatedAt ?? "briefing"} className="briefing-settle space-y-2.5">
              {b.weather && <DashboardBriefingWeather weather={b.weather} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
