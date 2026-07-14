"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Sparkles,
  Clock,
  Timer,
  ExternalLink,
  GitPullRequest,
  EyeOff,
  Eye,
  Plus,
  ArrowLeft,
  ListTodo,
  Sunrise,
  Sun,
  Sunset,
  Moon,
} from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { TaskList } from "@/components/TaskList";
import { JiraKeyChip } from "@/components/JiraKeyChip";
import { JiraStatusPill } from "@/components/JiraStatusPill";
import { LayoutPresetsButton } from "@/components/LayoutPresets";
import { TodayBootScreen, useTodayBoot } from "@/components/TodayBootScreen";
import { readFocusSession, writeFocusSession } from "@/lib/focus-session-storage";
import { todayISO, yesterdayISO, dailyNotePath, formatDayLabel, formatTime } from "@/lib/utils";
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
  tasks?: { done: boolean; abandonedAt?: string; movedAt?: string; text?: string }[];
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

function greetingForHour(hour: number): { label: string; Icon: typeof Sun } {
  if (hour >= 5 && hour < 12) return { label: "Good morning", Icon: Sunrise };
  if (hour >= 12 && hour < 17) return { label: "Good afternoon", Icon: Sun };
  if (hour >= 17 && hour < 22) return { label: "Good evening", Icon: Sunset };
  return { label: "Up late", Icon: Moon };
}

const emptySubscribe = () => () => {};

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function LiveClock() {
  const [clock, setClock] = useState<string>(() => formatClock(new Date()));
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => setClock(formatClock(new Date()));
    const start = () => {
      if (id) return;
      tick();
      id = setInterval(tick, 1000);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return (
    <span
      className="font-mono"
      style={{ fontSize: 13 }}
      aria-label={`Current time ${clock}`}
      suppressHydrationWarning
    >
      {clock}
    </span>
  );
}

interface HeroEvent {
  title: string;
  start?: string;
  end?: string;
  isAllDay?: boolean;
}

function nowNextEvent(
  events: HeroEvent[] | undefined,
): { kind: "now" | "next"; event: HeroEvent; whenLabel: string } | null {
  const now = Date.now();
  const timed = (events ?? []).filter((e) => !e.isAllDay && e.start && e.end && e.title);
  const current = timed.find(
    (e) => Date.parse(e.start as string) <= now && now < Date.parse(e.end as string),
  );
  if (current) {
    const ends = new Date(current.end as string).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return { kind: "now", event: current, whenLabel: `ends ${ends}` };
  }
  const upcoming = timed
    .filter((e) => Date.parse(e.start as string) > now)
    .sort((a, b) => Date.parse(a.start as string) - Date.parse(b.start as string))[0];
  if (!upcoming) return null;
  const mins = Math.ceil((Date.parse(upcoming.start as string) - now) / 60000);
  const whenLabel =
    mins <= 120
      ? `in ${mins}m`
      : `at ${new Date(upcoming.start as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return { kind: "next", event: upcoming, whenLabel };
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
  if (readFocusSession()) return; // already running - the top-bar timer owns it
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
  const [, setNow] = useState(() => new Date());
  const [skips, setSkips] = useState<Record<string, string>>(() => readSkips());
  const [showSkipped, setShowSkipped] = useState(false);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

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
  const tasksTotal = (taskData?.tasks ?? []).length;
  const ticketsInProgress = tickets.filter((t) => t.status.toLowerCase().includes("progress")).length;
  const streak = completionStreak(Array.isArray(history) ? history : [], doneToday, today);
  const yesterdayLink = `/notes/${dailyNotePath(yesterdayISO())}`;
  const dayLabel = formatDayLabel(today);

  const briefingLine =
    briefing?.ok && briefing.text
      ? briefing.text
      : briefing && briefing.ok === false
        ? null
        : undefined; // undefined = still loading

  return (
    <div className="hub today-home">
      <TodayBootScreen state={boot} />
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Header - matches dashboard hero */}
        <div className="hub-hero">
          <div>
            <div className="hub-hero-greeting" aria-hidden>
              {mounted &&
                (() => {
                  const { label, Icon } = greetingForHour(new Date().getHours());
                  return (
                    <span className="fade-rise inline-flex items-center gap-1.5">
                      <Icon size={12} aria-hidden />
                      {label}
                    </span>
                  );
                })()}
            </div>
            <h1 className="hub-hero-date">{dayLabel}</h1>
            <div className="hub-hero-sub">
              <LiveClock />
              {tasksTotal > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    <span key={doneToday} className="count-tick">{doneToday}</span>/{tasksTotal} tasks done
                  </span>
                  <span
                    className="hub-hero-progress"
                    data-complete={doneToday === tasksTotal || undefined}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={tasksTotal}
                    aria-valuenow={doneToday}
                    aria-label="Tasks done today"
                  >
                    <i style={{ width: `${tasksTotal > 0 ? Math.round((doneToday / tasksTotal) * 100) : 0}%` }} />
                  </span>
                </>
              )}
              <span aria-hidden>·</span>
              <Link href={yesterdayLink} className="hub-hero-link">
                <ArrowLeft size={11} aria-hidden /> Yesterday
              </Link>
            </div>
            {(() => {
              const signal = nowNextEvent(cal?.events);
              const topTask = (taskData?.tasks ?? []).find(
                (t) => !t.done && !t.abandonedAt && !t.movedAt && t.text,
              );
              if (!signal && !topTask) return null;
              return (
                <div className="hub-hero-signals">
                  {signal && (
                    <Link href="/calendar" className="hero-signal" aria-label={`${signal.kind === "now" ? "Happening now" : "Up next"}: ${signal.event.title}, ${signal.whenLabel}`}>
                      <span
                        className={`hero-signal-dot${signal.kind === "now" ? " live-dot" : ""}`}
                        data-kind={signal.kind}
                        aria-hidden
                      />
                      <span className="hero-signal-kind">{signal.kind === "now" ? "Now" : "Next"}</span>
                      <span className="hero-signal-text">{signal.event.title}</span>
                      <span className="hero-signal-meta">{signal.whenLabel}</span>
                    </Link>
                  )}
                  {topTask && (
                    <span className="hero-signal" aria-label={`Top task: ${topTask.text}`}>
                      <ListTodo size={11} aria-hidden style={{ color: "var(--accent)" }} />
                      <span className="hero-signal-kind">Task</span>
                      <span className="hero-signal-text">{topTask.text}</span>
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => window.dispatchEvent(new CustomEvent("devhub:capture-open"))}
              data-tooltip="Quick capture (⌘⇧C)"
              data-tooltip-pos="bottom-end"
            >
              <Plus size={13} aria-hidden /> Capture
            </button>
            <LayoutPresetsButton />
          </div>
        </div>

        {/* Briefing - calm accent strip, same language as the dashboard's widget */}
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
                - {clearTimeUntil(nextMeeting.start)} of clear focus until then
              </span>
            </span>
          ) : (
            <span style={{ color: "var(--text-subtle)" }}>No more meetings today - the day is yours.</span>
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

        {/* Reviews - pick one or two, skip the rest until tomorrow */}
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
                    <span className="min-w-0 shrink truncate font-mono text-[11px]" style={{ color: "var(--text-subtle)" }}>
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
                  Queue cleared - everything else is skipped until tomorrow.
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

        {/* Jira assignments - so a new one never slips past unnoticed */}
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
                  <JiraStatusPill ticketKey={t.key} status={t.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Then - the real task list (full check/strike animations, drag, add) */}
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
