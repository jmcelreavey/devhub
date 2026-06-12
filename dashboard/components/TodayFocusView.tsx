"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Clock, Timer, ExternalLink, GitPullRequest, EyeOff, Eye } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { TaskList } from "@/components/TaskList";
import { JiraKeyChip } from "@/components/JiraKeyChip";
import { SeverityPill } from "@/components/ui/Severity";
import { statusTone } from "@/components/JiraWidget";
import { LayoutPresetsButton } from "@/components/LayoutPresets";
import { TodayBootScreen, useTodayBoot } from "@/components/TodayBootScreen";
import { readFocusSession, writeFocusSession } from "@/lib/focus-session-storage";
import { todayISO, formatTime } from "@/lib/utils";
import type { GithubPrRow, GithubPrsApiPayload } from "@/lib/github-prs";
import type { CalendarEvent } from "@/lib/google-calendar";

interface BriefingResponse {
  ok: boolean;
  text?: string;
  code?: string;
}

interface JiraTicketRow {
  key: string;
  summary?: string;
  status: string;
  url?: string;
}

interface JiraResponse {
  tickets?: JiraTicketRow[];
  configured?: boolean;
}

interface CalendarResponse {
  events?: CalendarEvent[];
  error?: string;
}

interface TasksResponse {
  tasks?: { done: boolean; abandonedAt?: string; movedAt?: string }[];
}

interface TaskHistoryDay {
  date: string;
  completed: number;
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Consecutive days with at least one completed task, ending today (or
 * yesterday if today hasn't scored yet). Quiet positive reinforcement —
 * whisper-line text only, shown from 2 days up.
 */
function completionStreak(days: readonly TaskHistoryDay[], doneToday: number, today: string): number {
  const byDate = new Map(days.map((d) => [d.date, d.completed]));
  if (doneToday > 0) byDate.set(today, Math.max(byDate.get(today) ?? 0, doneToday));
  const cursor = new Date(`${today}T12:00:00`);
  if ((byDate.get(today) ?? 0) === 0) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while ((byDate.get(localISO(cursor)) ?? 0) > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function greetingForHour(h: number): string {
  if (h < 5) return "Late one.";
  if (h < 7) return "Early start.";
  if (h < 12) return "Morning.";
  if (h < 18) return "Afternoon.";
  if (h < 22) return "Evening.";
  return "Late one.";
}

function focusSubline(d: Date): string {
  const day = d.toLocaleDateString([], { weekday: "long" }).toUpperCase();
  const date = d.toLocaleDateString([], { month: "long", day: "numeric" }).toUpperCase();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${day} · ${date} · ${time}`;
}

function isUpcoming(e: CalendarEvent): boolean {
  return !e.isAllDay && new Date(e.start).getTime() > Date.now();
}

function clearTimeUntil(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m >= 30 ? `${h}.5h` : `${h}h`;
}

/** 45-minute deep-work block — same session store the top-bar timer uses. */
function startDeepWork(): void {
  if (readFocusSession()) return; // already running — the top-bar timer owns it
  const totalMs = 45 * 60_000;
  writeFocusSession({ endsAt: Date.now() + totalMs, totalMs });
}

// ── Review skips: "not this one today" — resets at midnight ──────────────
const SKIP_KEY = "devhub:review-skips";

function prId(row: GithubPrRow): string {
  return `${row.repo}#${row.number}`;
}

function readSkips(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SKIP_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSkips(skips: Record<string, string>): void {
  try {
    window.localStorage.setItem(SKIP_KEY, JSON.stringify(skips));
  } catch {
    // private mode / quota
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-bold"
      style={{ fontSize: 10.5, letterSpacing: ".08em", color: "var(--text-subtle)", marginBottom: 8 }}
    >
      {children}
    </div>
  );
}

/**
 * Calm Focus — the default Today view. Briefing, next meeting, the review
 * queue (pick one or two, skip the rest until tomorrow — reviewed/merged
 * PRs drop off automatically on refresh), your Jira assignments (so a new
 * one never slips past), and the task list. Tasks live only in THEN.
 */
export function TodayFocusView() {
  const [now, setNow] = useState(() => new Date());
  const [skips, setSkips] = useState<Record<string, string>>(() => readSkips());
  const [showSkipped, setShowSkipped] = useState(false);

  // Minute-resolution clock; pauses while the tab is hidden.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!id) id = setInterval(() => setNow(new Date()), 30_000);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        setNow(new Date());
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const { data: briefing } = useLive<BriefingResponse>("/api/dashboard/morning-briefing", {
    refreshInterval: 0,
  });
  const { data: prs } = useLive<GithubPrsApiPayload>("/api/github/prs");
  const { data: jira } = useLive<JiraResponse>("/api/jira/tickets");
  const { data: cal } = useLive<CalendarResponse>("/api/calendar");
  const { data: taskData } = useLive<TasksResponse>("/api/tasks");
  const { data: history } = useLive<TaskHistoryDay[]>("/api/tasks/history", {
    refreshInterval: 0,
  });

  // Single boot moment instead of per-section skeleton pops. The (slow,
  // AI-generated) briefing is deliberately excluded — it settles in behind
  // its own shimmer without holding the door.
  const boot = useTodayBoot(
    prs !== undefined && jira !== undefined && cal !== undefined && taskData !== undefined,
  );

  const today = todayISO();
  const skipPr = useCallback((id: string) => {
    setSkips((prev) => {
      const next = { ...prev, [id]: todayISO() };
      writeSkips(next);
      return next;
    });
  }, []);
  const unskipPr = useCallback((id: string) => {
    setSkips((prev) => {
      const next = { ...prev };
      delete next[id];
      writeSkips(next);
      return next;
    });
  }, []);

  const reviews = useMemo(
    () => (prs?.configured ? (prs.reviews ?? []) : []),
    [prs],
  );
  const activeReviews = reviews.filter((r) => skips[prId(r)] !== today);
  const skippedReviews = reviews.filter((r) => skips[prId(r)] === today);

  const tickets = jira?.configured === true ? (jira.tickets ?? []) : [];
  const nextMeeting = (cal?.events ?? []).find(isUpcoming);

  const doneToday = (taskData?.tasks ?? []).filter((t) => t.done).length;
  const ticketsInProgress = tickets.filter((t) => t.status.toLowerCase().includes("progress")).length;
  const streak = completionStreak(Array.isArray(history) ? history : [], doneToday, today);

  const briefingLine =
    briefing?.ok && briefing.text
      ? briefing.text
      : briefing && briefing.ok === false
        ? null
        : undefined; // undefined = still loading

  return (
    <div className="hub">
      <TodayBootScreen state={boot} />
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="hub-hero-sub font-mono" style={{ fontSize: 12 }} suppressHydrationWarning>
              {focusSubline(now)}
            </div>
            <h1 className="hub-hero-date" style={{ fontSize: 28, margin: "6px 0 0" }} suppressHydrationWarning>
              {greetingForHour(now.getHours())}
            </h1>
          </div>
          <LayoutPresetsButton />
        </div>

        {/* Briefing — calm accent strip, same language as the dashboard's widget */}
        {briefingLine !== null && (
          <div
            className="flex items-start gap-3"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderLeft: "3px solid var(--accent)",
              borderRadius: "var(--radius, 8px)",
              padding: "12px 16px",
            }}
          >
            <Sparkles size={14} style={{ color: "var(--accent)", flex: "none", marginTop: 3 }} aria-hidden />
            {briefingLine === undefined ? (
              <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
                <div className="skeleton" style={{ height: 12, width: "92%" }} />
                <div className="skeleton" style={{ height: 12, width: "70%" }} />
              </div>
            ) : (
              <p
                className="briefing-settle min-w-0 flex-1 text-sm leading-relaxed"
                style={{ color: "var(--text-muted)", margin: 0 }}
              >
                {briefingLine}
              </p>
            )}
          </div>
        )}

        {/* Next meeting + focus */}
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Clock size={12} aria-hidden style={{ flex: "none" }} />
          {nextMeeting ? (
            <span className="min-w-0 truncate">
              Next meeting{" "}
              <b style={{ color: "var(--text)", fontWeight: 600 }}>
                {nextMeeting.title} · {formatTime(nextMeeting.start)}
              </b>{" "}
              <span style={{ color: "var(--text-subtle)" }}>
                — {clearTimeUntil(nextMeeting.start)} of clear focus until then
              </span>
            </span>
          ) : (
            <span style={{ color: "var(--text-subtle)" }}>No more meetings today — the day is yours.</span>
          )}
          <button
            type="button"
            onClick={startDeepWork}
            className="btn btn-ghost ml-auto shrink-0"
            style={{ fontSize: 11.5, padding: "2px 9px" }}
            title="Start a 45-minute focus session"
          >
            <Timer size={11} aria-hidden /> Start focus
          </button>
        </div>

        {/* Reviews — pick one or two, skip the rest until tomorrow */}
        {(activeReviews.length > 0 || skippedReviews.length > 0) && (
          <div>
            <SectionLabel>REVIEWS OWED</SectionLabel>
            <div className="space-y-1">
              {activeReviews.map((r) => {
                const id = prId(r);
                return (
                  <div
                    key={id}
                    className="group flex items-center gap-2.5 rounded px-2 py-1.5"
                    style={{ border: "1px solid var(--border-muted)", background: "var(--bg-surface)" }}
                  >
                    <GitPullRequest size={13} style={{ color: "var(--warning)", flex: "none" }} aria-hidden />
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-sm hover:underline"
                      style={{ color: "var(--text)" }}
                    >
                      {r.title}
                    </a>
                    <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--text-subtle)" }}>
                      {id}
                    </span>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost shrink-0"
                      style={{ fontSize: 11, padding: "1px 8px" }}
                      aria-label={`Open ${id}`}
                    >
                      <ExternalLink size={10} aria-hidden /> Open
                    </a>
                    <button
                      type="button"
                      onClick={() => skipPr(id)}
                      className="btn btn-ghost shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      style={{ fontSize: 11, padding: "1px 8px", color: "var(--text-subtle)" }}
                      title="Skip until tomorrow"
                    >
                      <EyeOff size={10} aria-hidden /> Skip
                    </button>
                  </div>
                );
              })}
              {activeReviews.length === 0 && (
                <div className="text-xs" style={{ color: "var(--text-subtle)", padding: "2px 2px" }}>
                  Queue cleared — everything else is skipped until tomorrow.
                </div>
              )}
              {skippedReviews.length > 0 && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 pt-1 text-xs"
                  style={{ color: "var(--text-subtle)", background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => setShowSkipped((v) => !v)}
                  aria-expanded={showSkipped}
                >
                  {showSkipped ? <Eye size={11} aria-hidden /> : <EyeOff size={11} aria-hidden />}
                  {skippedReviews.length} skipped until tomorrow
                </button>
              )}
              {showSkipped &&
                skippedReviews.map((r) => {
                  const id = prId(r);
                  return (
                    <div key={id} className="flex items-center gap-2.5 px-2 py-1" style={{ opacity: 0.55 }}>
                      <GitPullRequest size={12} style={{ color: "var(--text-subtle)", flex: "none" }} aria-hidden />
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-xs hover:underline"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {r.title}
                      </a>
                      <button
                        type="button"
                        onClick={() => unskipPr(id)}
                        className="btn btn-ghost shrink-0"
                        style={{ fontSize: 11, padding: "1px 8px" }}
                      >
                        Unskip
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Jira assignments — so a new one never slips past unnoticed */}
        {tickets.length > 0 && (
          <div>
            <SectionLabel>JIRA</SectionLabel>
            <div className="space-y-1">
              {tickets.slice(0, 6).map((t) => (
                <div key={t.key} className="flex items-center gap-2.5 px-2 py-1">
                  <JiraKeyChip jiraKey={t.key} />
                  {t.url ? (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-sm hover:underline"
                      style={{ color: "var(--text)" }}
                    >
                      {t.summary ?? t.key}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text)" }}>
                      {t.summary ?? t.key}
                    </span>
                  )}
                  <SeverityPill tone={statusTone(t.status)}>{t.status}</SeverityPill>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Then — the real task list (full check/strike animations, drag, add) */}
        <div>
          <SectionLabel>TASKS</SectionLabel>
          <TaskList inputId="focus-task-add" />
        </div>

        {/* Everything else is a whisper */}
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          style={{ color: "var(--text-subtle)" }}
        >
          {activeReviews.length > 0 && (
            <>
              <span>
                <b style={{ color: "var(--text-muted)", fontWeight: 600 }}>{activeReviews.length}</b> review
                {activeReviews.length !== 1 ? "s" : ""} waiting
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          {ticketsInProgress > 0 && (
            <>
              <span>
                <b style={{ color: "var(--text-muted)", fontWeight: 600 }}>{ticketsInProgress}</b> ticket
                {ticketsInProgress !== 1 ? "s" : ""} in progress
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>
            <b style={{ color: "var(--text-muted)", fontWeight: 600 }}>
              <span key={doneToday} className="count-tick">{doneToday}</span>
            </b>{" "}
            done today
          </span>
          {streak >= 2 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <b style={{ color: "var(--text-muted)", fontWeight: 600 }}>{streak}</b>-day streak
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
