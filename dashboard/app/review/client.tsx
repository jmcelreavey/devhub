"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { FetchError, SkeletonRows } from "@/components";
import { useLive } from "@/lib/use-fetch";
import { localCalendarDateISO } from "@/lib/local-calendar-date";
import { jiraBrowseUrl } from "@/lib/utils";
import type { WeeklyReview } from "@/lib/tasks-weekly";

function shiftISODate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return localCalendarDateISO(d);
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function weekdayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

const STATS: { key: keyof WeeklyReview["totals"]; label: string; color: string }[] = [
  { key: "completed", label: "Completed", color: "var(--success)" },
  { key: "created", label: "Created", color: "var(--text)" },
  { key: "abandoned", label: "Abandoned", color: "var(--text-subtle)" },
  { key: "moved", label: "Rolled over", color: "var(--accent)" },
];

export default function ReviewPage() {
  const today = localCalendarDateISO();
  const [end, setEnd] = useState(today);
  const { data, error, isLoading } = useLive<WeeklyReview>(`/api/tasks/weekly?end=${end}`);

  const maxCreated = useMemo(
    () => Math.max(1, ...(data?.days ?? []).map((d) => d.created)),
    [data],
  );

  const isThisWeek = end === today;

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <div className="page-title">Weekly review</div>
          <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
            {data ? `${shortDate(data.start)} – ${shortDate(data.end)}` : "Last 7 days"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={() => setEnd((e) => shiftISODate(e, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft size={12} aria-hidden /> Prev
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            disabled={isThisWeek}
            onClick={() => setEnd(today)}
          >
            This week
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            disabled={isThisWeek}
            onClick={() => setEnd((e) => shiftISODate(e, 7))}
            aria-label="Next week"
          >
            Next <ChevronRight size={12} aria-hidden />
          </button>
        </div>
      </div>

      {error && <FetchError message="Couldn't load weekly review." />}
      {isLoading && !data && <SkeletonRows count={3} height={60} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
            {STATS.map((s) => (
              <div key={s.key} className="card card-body">
                <div className="text-2xl font-mono tabular-nums" style={{ color: s.color }}>
                  {data.totals[s.key]}
                </div>
                <div className="text-xs" style={{ color: "var(--text-subtle)" }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="card card-body mb-4">
            <div className="text-xs font-medium mb-3" style={{ color: "var(--text-muted)" }}>
              Throughput
            </div>
            <div className="space-y-2">
              {data.days.map((d) => (
                <div key={d.date} className="flex items-center gap-3">
                  <span className="w-10 shrink-0 text-xs font-mono" style={{ color: "var(--text-subtle)" }}>
                    {weekdayLabel(d.date)}
                  </span>
                  <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${(d.completed / maxCreated) * 100}%`,
                        background: "var(--success)",
                        borderRadius: 9,
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs font-mono tabular-nums" style={{ color: "var(--text-subtle)" }}>
                    {d.completed}/{d.created}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-body">
            <div className="text-xs font-medium mb-3" style={{ color: "var(--text-muted)" }}>
              What slipped <span style={{ color: "var(--text-subtle)" }}>· rolled over 3+ days</span>
            </div>
            {data.slipped.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
                Nothing chronically slipping this week. Nice.
              </p>
            ) : (
              <div className="space-y-2">
                {data.slipped.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="badge badge-muted shrink-0">{s.movedCount}d</span>
                    {s.jiraKey && (
                      <a
                        href={jiraBrowseUrl(s.jiraKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 font-mono text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                        style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
                      >
                        {s.jiraKey}
                        <ExternalLink size={10} aria-hidden />
                      </a>
                    )}
                    <span className="text-sm min-w-0 break-words" style={{ color: "var(--text)" }}>
                      {s.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
