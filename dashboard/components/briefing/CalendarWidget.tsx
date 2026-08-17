"use client";

import { Calendar, Clock, AlertCircle } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { CalendarEvent } from "@/lib/google-calendar";
import { formatTime } from "@/lib/utils";
import { TodayCollapseButton } from "@/components/today/TodayCollapseButton";
import { CalendarEventRow, eventJoinIsUrgent } from "@/components/briefing/CalendarEventRow";

interface CalendarResponse {
  events?: CalendarEvent[];
  configured?: boolean;
  error?: string;
}

interface CalendarWidgetProps {
  collapsed?: boolean;
  collapsedSummary?: string;
  onToggle?: () => void;
}

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function isHappeningNow(start: string, end: string): boolean {
  const now = Date.now();
  return now >= new Date(start).getTime() && now <= new Date(end).getTime();
}

function isFuture(iso: string): boolean {
  return new Date(iso).getTime() > Date.now();
}

/** Within 10 minutes of starting — the only time the Join button breathes. */
function isImminent(iso: string): boolean {
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 && ms <= 10 * 60_000;
}

export function CalendarWidget({ collapsed = false, collapsedSummary, onToggle }: CalendarWidgetProps) {
  const { data, error, isLoading } = useLive<CalendarResponse>("/api/calendar");

  if (isLoading) {
    return <div className="skeleton" style={{ height: 60, borderRadius: "var(--radius)" }} />;
  }

  if (error) {
    return (
      <div
        className="card"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <AlertCircle size={12} className="text-danger" aria-hidden />
        Couldn&apos;t load calendar.
      </div>
    );
  }

  if (data?.error) return null;
  const events = data?.events ?? [];

  const now = events.find((e) => !e.isAllDay && isHappeningNow(e.start, e.end));
  const next = events.find(
    (e) => !e.isAllDay && isFuture(e.start) && !isHappeningNow(e.start, e.end),
  );

  return (
    <div
      className="card today-grid-drag-handle"
      data-collapsed={collapsed ? "true" : undefined}
      style={{ padding: "10px 14px" }}
    >
      <div className="today-card-inline-head mb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Calendar size={13} aria-hidden />
          <span className="text-xs font-semibold text-text-muted">
            Today
          </span>
          <span className="text-xs text-text-subtle">
            {events.length > 0
              ? `${events.length} event${events.length !== 1 ? "s" : ""}`
              : "No events today"}
          </span>
        </div>
        {onToggle ? <TodayCollapseButton collapsed={collapsed} label="Calendar" onToggle={onToggle} /> : null}
      </div>

      {collapsed ? <div className="today-collapsed-summary">{collapsedSummary}</div> : null}

      {!collapsed && now && (
        <div className="flex items-center gap-2 text-sm mb-2">
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-[var(--radius-sm)] animate-pulse"
            style={{ background: "var(--danger)" }}
          />
          <span className="min-w-0 truncate text-text">
            {now.title}
          </span>
          <span className="text-xs shrink-0 text-text-subtle">
            until {formatTime(now.end)}
          </span>
          {now.conferenceUrl && (
            <a
              href={now.conferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Join meeting"
              className="urgency-pulse inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              Join
            </a>
          )}
        </div>
      )}

      {!collapsed && next && !now && (
        <div className="flex items-center gap-2 text-sm mb-2">
          <Clock size={13} className="text-text-subtle" aria-hidden />
          <span className="text-text-muted">Next:</span>
          <span className="min-w-0 truncate text-text">
            {next.title}
          </span>
          <span
            className="text-xs shrink-0"
            style={{ color: isImminent(next.start) ? "var(--warning)" : "var(--accent)" }}
          >
            in {timeUntil(next.start)}
          </span>
          {next.conferenceUrl && eventJoinIsUrgent(next) && (
            <a
              href={next.conferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="urgency-pulse inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              Join
            </a>
          )}
        </div>
      )}

      {!collapsed && !now && !next && (
        <div className="text-xs text-text-subtle">
          {events.length > 0 ? "Done for today." : "Nothing scheduled."}
        </div>
      )}

      {!collapsed ? (
        <div className="space-y-0.5 mt-1">
          {events.slice(0, 5).map((e) => (
            <CalendarEventRow key={e.id} event={e} density="compact" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
