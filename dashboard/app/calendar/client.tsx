"use client";

import { useCallback, useState } from "react";
import { Calendar, ChevronDown, ChevronUp, MapPin, RefreshCw, Settings2, Video } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import type { CalendarEvent, GoogleCalendarInfo } from "@/lib/google-calendar";
import { CreateMeetingNoteButton } from "@/components/CreateMeetingNoteButton";
import { formatTime, todayISO } from "@/lib/utils";
import { EmptyState, FetchError, PageHeader, SkeletonRows } from "@/components";

function isToday(dateStr: string): boolean {
  return dateStr === todayISO();
}

interface WeekResponse {
  days?: Record<string, CalendarEvent[]>;
}

interface CalendarsResponse {
  configured?: boolean;
  calendars?: GoogleCalendarInfo[];
  selectedIds?: string[];
  error?: string;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function CalendarPicker({
  calendars,
  selectedIds,
  onChange,
  saving,
}: {
  calendars: GoogleCalendarInfo[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  saving: boolean;
}) {
  if (calendars.length === 0) {
    return (
      <p className="text-xs py-2" style={{ color: "var(--text-subtle)" }}>
        No calendars found for this account.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {calendars.map((cal) => {
        const checked = selectedIds.has(cal.id);
        return (
          <label
            key={cal.id}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-[var(--surface-2)]"
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={saving}
              onChange={() => {
                const next = new Set(selectedIds);
                if (checked) next.delete(cal.id);
                else next.add(cal.id);
                onChange(next);
              }}
            />
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: cal.backgroundColor ?? "var(--accent)" }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>
              {cal.summary}
            </span>
            {cal.primary ? (
              <span className="badge badge-muted text-[10px]">Primary</span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

export default function CalendarPage() {
  const { data, error, isLoading, mutate, isValidating } = useLive<WeekResponse>("/api/calendar/week");
  const {
    data: calData,
    error: calError,
    mutate: mutateCalendars,
  } = useLive<CalendarsResponse>("/api/calendar/calendars");

  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const days = data?.days ?? {};
  const sortedDays = Object.keys(days).sort();
  const calendars = calData?.calendars ?? [];
  const selectedIds = new Set(calData?.selectedIds ?? []);
  const multiCalendar = selectedIds.size > 1;

  const saveSelection = useCallback(
    async (next: Set<string>) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch("/api/calendar/calendars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendarIds: [...next] }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Couldn't save calendar selection");
        await Promise.all([mutateCalendars(), mutate()]);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Couldn't save calendar selection");
      } finally {
        setSaving(false);
      }
    },
    [mutate, mutateCalendars],
  );

  return (
    <div className="page-wrapper">
      <PageHeader
        title="Calendar"
        subtitle={
          selectedIds.size > 0
            ? `${selectedIds.size} calendar${selectedIds.size === 1 ? "" : "s"} shown`
            : undefined
        }
        actions={
          <>
            {calData?.configured ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: "12px", padding: "4px 10px" }}
                onClick={() => setShowPicker((open) => !open)}
                aria-expanded={showPicker}
              >
                <Settings2 size={12} aria-hidden />
                Calendars
                {showPicker ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: "12px", padding: "4px 10px" }}
              onClick={() => void mutate()}
              disabled={isValidating}
              aria-label="Refresh calendar"
            >
              <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden />
            </button>
          </>
        }
      />

      {showPicker && calData?.configured ? (
        <div className="card mb-4">
          <div className="card-header">
            <span>Visible calendars</span>
            {saving ? <span className="text-xs" style={{ color: "var(--text-subtle)" }}>Saving…</span> : null}
          </div>
          <div className="card-body" style={{ padding: "8px 12px" }}>
            {calError ? (
              <FetchError message="Couldn't load calendars." onRetry={() => void mutateCalendars()} />
            ) : (
              <CalendarPicker
                calendars={calendars}
                selectedIds={selectedIds}
                saving={saving}
                onChange={(next) => void saveSelection(next)}
              />
            )}
            {saveError ? (
              <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>
                {saveError}
              </p>
            ) : null}
            <p className="text-xs mt-3" style={{ color: "var(--text-subtle)" }}>
              Defaults to calendars checked in Google Calendar until you change this list.
            </p>
          </div>
        </div>
      ) : null}

      {error && <FetchError message="Couldn't load calendar." onRetry={() => void mutate()} />}

      {isLoading && !data && <SkeletonRows count={3} height={80} />}

      {!isLoading && !error && sortedDays.length === 0 && (
        <EmptyState
          icon={<Calendar size={28} />}
          title="No calendar connected."
          subtitle={
            <>
              Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and{" "}
              <code>GOOGLE_REFRESH_TOKEN</code> in <code>.env.local</code> to enable calendar integration.
            </>
          }
        />
      )}

      <div className="space-y-4">
        {sortedDays.map((dateStr) => (
          <div key={dateStr} className="card">
            <div
              className="card-header"
              style={{
                color: isToday(dateStr) ? "var(--accent)" : undefined,
                borderBottom: isToday(dateStr) ? "2px solid var(--accent)" : undefined,
              }}
            >
              <span>
                {formatDay(dateStr)}
                {isToday(dateStr) ? " (Today)" : ""}
              </span>
              <span className="badge badge-muted">{days[dateStr].length}</span>
            </div>
            <div className="card-body" style={{ padding: "8px 16px" }}>
              {days[dateStr].length === 0 && (
                <p className="text-xs py-2" style={{ color: "var(--text-subtle)" }}>
                  Nothing scheduled.
                </p>
              )}
              {days[dateStr].map((e) => (
                <div
                  key={e.id}
                  className="flex items-start gap-3 py-2 text-sm"
                  style={{ borderTop: "1px solid var(--border-muted)" }}
                >
                  <div
                    className="shrink-0 text-xs font-mono"
                    style={{ color: "var(--text-subtle)", minWidth: "50px" }}
                  >
                    {e.isAllDay ? (
                      "All day"
                    ) : (
                      <>
                        {formatTime(e.start)}
                        <br />
                        <span style={{ color: "var(--text-subtle)" }}>{formatTime(e.end)}</span>
                      </>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium break-words leading-snug" style={{ color: "var(--text)" }}>
                      {e.title}
                    </div>
                    {multiCalendar && e.calendarName ? (
                      <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: "var(--text-subtle)" }}>
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ background: e.calendarColor ?? "var(--accent)" }}
                          aria-hidden
                        />
                        {e.calendarName}
                      </div>
                    ) : null}
                    {e.location && (
                      <div
                        className="text-xs flex items-center gap-1 mt-0.5"
                        style={{ color: "var(--text-subtle)" }}
                      >
                        <MapPin size={10} aria-hidden /> {e.location}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-start">
                    {e.conferenceUrl && (
                      <a
                        href={e.conferenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost"
                        style={{ fontSize: "11px", padding: "3px 6px" }}
                        aria-label={`Join ${e.title}`}
                      >
                        <Video size={11} aria-hidden /> Join
                      </a>
                    )}
                    <CreateMeetingNoteButton event={e} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
