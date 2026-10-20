"use client";

import { useState } from "react";
import { Sun, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { DailyBriefing } from "@/lib/morning-briefing";
import { TodayCollapseButton } from "@/components/today/TodayCollapseButton";
import { onTodayCardHeaderClick, TodayViewAllLink } from "@/components/today/TodayViewAllLink";
import { DashboardBriefingWeather, DashboardBriefingWeatherInline } from "@/components/briefing/DashboardBriefingWeather";
import { BriefingOwnedReposDigest, type BriefingRepoAttentionRow } from "@/components/briefing/BriefingOwnedReposDigest";
import { BriefingPlanStatus } from "@/components/briefing/BriefingPlanStatus";

interface BriefingResponse {
  ok: boolean;
  briefing?: DailyBriefing;
  generatedAt?: string;
  cached?: boolean;
  code?: string;
  message?: string;
  ownedRepoAttention?: BriefingRepoAttentionRow[];
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
      // Collapsed is one tight row, centred in its two-row grid slot.
      style={{
        padding: collapsed ? "var(--space-2) var(--space-3)" : "var(--space-3) var(--space-3)",
        justifyContent: collapsed ? "center" : undefined,
      }}
    >
      <div
        className="mbw-head flex items-center gap-2"
        style={{ marginBottom: collapsed ? 0 : "var(--space-2)" }}
        onClick={onTodayCardHeaderClick}
      >
        <Sun size={13} className="shrink-0 text-warning" aria-hidden />
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-text">
          Morning briefing
        </span>
        {collapsed && b?.weather ? <DashboardBriefingWeatherInline weather={b.weather} /> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <TodayViewAllLink href="/briefing" />
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
            <p className="text-sm text-text-subtle">
              {data?.message ?? "Briefing unavailable. Try refreshing."}
            </p>
          ) : (
            <div key={data?.generatedAt ?? "briefing"} className="briefing-settle space-y-2.5">
              {b.weather && <DashboardBriefingWeather weather={b.weather} />}
              <BriefingPlanStatus />
              {data?.ownedRepoAttention?.length ? (
                <BriefingOwnedReposDigest rows={data.ownedRepoAttention} />
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
