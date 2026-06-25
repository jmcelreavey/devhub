"use client";

import { useState, useCallback } from "react";
import { RefreshCw, Settings2, Sparkles } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { formatTime } from "@/lib/utils";
import type { DailyBriefing } from "@/lib/morning-briefing";
import {
  DEFAULT_BRIEFING_PREFS,
  type BriefingPrefs,
  type BriefingSectionId,
} from "@/lib/briefing-prefs-shared";
import { PageHeader } from "@/components";
import {
  WeatherStrip,
  DevTipCard,
  AiSummaryCard,
  NewsPanel,
  EventsPanel,
  AttractionsPanel,
  ReposPanel,
  HackerNewsPanel,
  GamingPanel,
  OnThisDayPanel,
  InterestsPanel,
} from "@/components/briefing-parts";
import { BriefingEditDialog } from "@/components/BriefingEditDialog";

interface BriefingResponse {
  ok: boolean;
  text?: string;
  briefing?: DailyBriefing;
  generatedAt?: string;
  cached?: boolean;
  code?: string;
  message?: string;
  prefs?: BriefingPrefs;
}

function useSectionCollapsed(): [Set<BriefingSectionId>, (id: BriefingSectionId) => void] {
  const [collapsed, setCollapsed] = useState<Set<BriefingSectionId>>(() => {
    if (typeof window === "undefined") return new Set<BriefingSectionId>();
    const stored = localStorage.getItem("devhub-briefing-collapsed");
    if (!stored) return new Set<BriefingSectionId>();
    try {
      return new Set(JSON.parse(stored) as BriefingSectionId[]);
    } catch {
      return new Set<BriefingSectionId>();
    }
  });

  const toggle = useCallback((id: BriefingSectionId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("devhub-briefing-collapsed", JSON.stringify([...next]));
      return next;
    });
  }, []);

  return [collapsed, toggle];
}

export default function Client() {
  const { data, isLoading, mutate } = useLive<BriefingResponse>("/api/dashboard/morning-briefing", {
    refreshInterval: 0,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSectionCollapsed();

  const refresh = useCallback(async () => {
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
  }, [mutate]);

  const loading = (isLoading && !data) || refreshing;
  const b = data?.ok ? data.briefing : undefined;
  const prefs = data?.prefs ?? DEFAULT_BRIEFING_PREFS;
  const s = prefs.sections;

  const onSaved = useCallback(() => {
    void refresh();
  }, [refresh]);

  const collapseProps = useCallback(
    (id: BriefingSectionId) => ({
      collapsed: collapsed.has(id),
      onToggleCollapse: () => toggleCollapsed(id),
    }),
    [collapsed, toggleCollapsed],
  );

  return (
    <div className="page-wrapper">
      <PageHeader
        title="Briefing"
        subtitle={
          data?.ok && data.generatedAt
            ? `Updated ${formatTime(data.generatedAt)}${data.cached ? "" : " · fresh"}`
            : "Your start-of-day digest"
        }
        actions={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: "12px", padding: "4px 10px" }}
              onClick={() => setEditOpen(true)}
              aria-label="Customize briefing"
            >
              <Settings2 size={12} aria-hidden /> Customize
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: "12px", padding: "4px 10px" }}
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh briefing"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} aria-hidden /> Refresh
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-3" style={{ maxWidth: 920 }}>
          <div className="skeleton" style={{ height: 96, width: "100%", borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 48, width: "100%", borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 12, width: "85%" }} />
          <div className="skeleton" style={{ height: 12, width: "70%" }} />
        </div>
      ) : !b ? (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
            {data?.message ?? "Briefing unavailable. Try refreshing."}
          </p>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => setEditOpen(true)}
          >
            <Settings2 size={12} aria-hidden /> Customize your briefing
          </button>
        </div>
      ) : (
        <div key={data?.generatedAt ?? "briefing"} className="briefing-settle briefing-screen">
          {/* Hero band: weather + AI summary + dev tip */}
          {(s.weather || b.aiSummary || s.devTip) && (
            <div className="briefing-hero-band">
              {s.weather && b.weather && <WeatherStrip weather={b.weather} />}
              {b.aiSummary && <AiSummaryCard summary={b.aiSummary} />}
              {s.devTip && b.devTip && <DevTipCard tip={b.devTip} />}
            </div>
          )}

          {/* Config-driven card grid */}
          <div className="briefing-grid">
            {s.events && b.events.length > 0 && <EventsPanel items={b.events} {...collapseProps("events")} />}
            {s.attractions && prefs.hasKids && <AttractionsPanel area={prefs.attractionsArea} {...collapseProps("attractions")} />}
            {s.news && b.news.length > 0 && <NewsPanel items={b.news} {...collapseProps("news")} />}
            {s.github && b.github.length > 0 && <ReposPanel repos={b.github} {...collapseProps("github")} />}
            {s.hackerNews && b.hackerNews.length > 0 && <HackerNewsPanel items={b.hackerNews} {...collapseProps("hackerNews")} />}
            {s.gaming && b.gaming.length > 0 && <GamingPanel items={b.gaming} {...collapseProps("gaming")} />}
            {s.onThisDay && b.onThisDay.length > 0 && <OnThisDayPanel items={b.onThisDay} {...collapseProps("onThisDay")} />}
            {s.interests && b.interestSnippets.length > 0 && (
              <InterestsPanel snippets={b.interestSnippets} {...collapseProps("interests")} />
            )}
          </div>

          {/* Empty state: all sections empty or disabled */}
          {!b.weather && !b.devTip && b.news.length === 0 && b.events.length === 0 &&
            b.github.length === 0 && b.hackerNews.length === 0 && b.gaming.length === 0 &&
            b.onThisDay.length === 0 && b.interestSnippets.length === 0 && !b.aiSummary && (
              <div className="briefing-empty-state">
                <Sparkles size={24} style={{ color: "var(--text-subtle)" }} aria-hidden />
                <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
                  Nothing to report yet. Try refreshing or{" "}
                  <button type="button" className="briefing-link" onClick={() => setEditOpen(true)}>
                    customize your briefing
                  </button>
                  .
                </p>
              </div>
            )}
        </div>
      )}

      {editOpen && (
        <BriefingEditDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          prefs={prefs}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
