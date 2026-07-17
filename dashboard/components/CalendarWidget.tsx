"use client";

import { Calendar, Clock, Video, AlertCircle } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import type { CalendarEvent } from "@/lib/google-calendar";
import { formatTime } from "@/lib/utils";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";
import { CreateMeetingNoteButton } from "@/components/CreateMeetingNoteButton";

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
        <AlertCircle size={12} style={{ color: "var(--danger)" }} aria-hidden />
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
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            Today
          </span>
          <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
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
          <span className="min-w-0 truncate" style={{ color: "var(--text)" }}>
            {now.title}
          </span>
          <span className="text-xs shrink-0" style={{ color: "var(--text-subtle)" }}>
            until {formatTime(now.end)}
          </span>
          {now.conferenceUrl && (
            <a
              href={now.conferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Join meeting"
              className="shrink-0"
            >
              <Video size={11} style={{ color: "var(--accent)" }} aria-hidden />
            </a>
          )}
          <span className="ml-auto shrink-0">
            <CreateMeetingNoteButton event={now} compact />
          </span>
        </div>
      )}

      {!collapsed && next && !now && (
        <div className="flex items-center gap-2 text-sm mb-2">
          <Clock size={13} style={{ color: "var(--text-subtle)" }} aria-hidden />
          <span style={{ color: "var(--text-muted)" }}>Next:</span>
          <span className="min-w-0 truncate" style={{ color: "var(--text)" }}>
            {next.title}
          </span>
          <span
            className="text-xs shrink-0"
            style={{ color: isImminent(next.start) ? "var(--warning)" : "var(--accent)" }}
          >
            in {timeUntil(next.start)}
          </span>
          {next.conferenceUrl && isImminent(next.start) && (
            <a
              href={next.conferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="urgency-pulse inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              <Video size={11} aria-hidden /> Join
            </a>
          )}
          <span className="ml-auto shrink-0">
            <CreateMeetingNoteButton event={next} compact />
          </span>
        </div>
      )}

      {!collapsed && !now && !next && (
        <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
          {events.length > 0 ? "Done for today." : "Nothing scheduled."}
        </div>
      )}

      {!collapsed ? (
        <div className="space-y-1 mt-1">
          {events.slice(0, 5).map((e) => (
            <div key={e.id} className="group flex items-center gap-2 text-xs">
              <span style={{ color: "var(--text-subtle)", minWidth: "44px" }}>
                {e.isAllDay ? "All day" : `${formatTime(e.start)}`}
              </span>
              <span
                className="min-w-0 truncate"
                style={{
                  color: isHappeningNow(e.start, e.end) ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {e.title}
              </span>
              {e.conferenceUrl && (
                <a
                  href={e.conferenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Join meeting"
                >
                  <Video size={10} style={{ color: "var(--accent)" }} aria-hidden />
                </a>
              )}
              <span className="ml-auto reveal-on-hover transition-opacity">
                <CreateMeetingNoteButton event={e} compact />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
