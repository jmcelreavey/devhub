"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Calendar, ListTodo, Ticket, Sparkles } from "lucide-react";
import Link from "next/link";
import { useLive } from "@/lib/use-fetch";
import { todayISO, formatTime } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/google-calendar";
import type { JiraTicket } from "@/lib/jira-client";

// Re-render every 30s so the "now" indicator slides forward. The snapshot
// must be stable between ticks.
const tlListeners = new Set<() => void>();
let tlTimer: ReturnType<typeof setInterval> | null = null;
let tlCachedNow = 0;
function tlEnsureTimer() {
  if (tlTimer || typeof window === "undefined") return;
  tlCachedNow = Date.now();
  tlTimer = setInterval(() => {
    tlCachedNow = Date.now();
    tlListeners.forEach((cb) => cb());
  }, 30_000);
}
function tlSubscribe(cb: () => void) {
  tlEnsureTimer();
  tlListeners.add(cb);
  return () => {
    tlListeners.delete(cb);
    if (tlListeners.size === 0 && tlTimer) {
      clearInterval(tlTimer);
      tlTimer = null;
    }
  };
}
function tlGetNow(): number {
  return tlCachedNow;
}

interface TaskShape {
  id: string;
  text: string;
  done: boolean;
  due?: string;
  jiraKey?: string;
  createdAt: string;
}

interface TimelineRow {
  id: string;
  kind: "event" | "task" | "ticket";
  time: number | null;
  title: string;
  meta?: string;
  href?: string;
  color: string;
  icon: React.ReactNode;
}

export function HubTimeline() {
  const { data: cal } = useLive<{ events?: CalendarEvent[]; error?: string }>(
    "/api/calendar",
  );
  const { data: tasks } = useLive<{ tasks?: TaskShape[] }>("/api/tasks");
  const { data: jira } = useLive<{ tickets?: JiraTicket[]; configured?: boolean }>(
    "/api/jira/tickets",
  );

  const rows = useMemo<TimelineRow[]>(() => {
    const out: TimelineRow[] = [];
    const today = todayISO();
    const startOfToday = new Date(today + "T00:00:00").getTime();
    const endOfToday = startOfToday + 86_400_000;

    for (const e of cal?.events ?? []) {
      const t = new Date(e.start).getTime();
      out.push({
        id: `event:${e.id}`,
        kind: "event",
        time: e.isAllDay ? null : t,
        title: e.title,
        meta: e.isAllDay ? "All day" : `${formatTime(t)} – ${formatTime(new Date(e.end).getTime())}`,
        color: "var(--accent)",
        icon: <Calendar size={11} aria-hidden />,
      });
    }
    for (const t of tasks?.tasks ?? []) {
      // Only include tasks scheduled for today (or with no due, treated as today).
      if (t.due && t.due !== today) continue;
      const ts = new Date(t.createdAt).getTime();
      const inToday = ts >= startOfToday && ts < endOfToday;
      out.push({
        id: `task:${t.id}`,
        kind: "task",
        time: inToday ? ts : null,
        title: t.text,
        meta: t.done ? "Done" : "Task",
        color: t.done ? "var(--success)" : "var(--warning)",
        icon: <ListTodo size={11} aria-hidden />,
      });
    }
    if (jira?.configured) {
      for (const t of (jira.tickets ?? []).slice(0, 5)) {
        out.push({
          id: `ticket:${t.key}`,
          kind: "ticket",
          time: null,
          title: `${t.key} · ${t.summary}`,
          meta: t.status,
          href: t.url,
          color: "var(--text-muted)",
          icon: <Ticket size={11} aria-hidden />,
        });
      }
    }

    out.sort((a, b) => {
      if (a.time === null && b.time === null) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time - b.time;
    });
    return out;
  }, [cal, tasks, jira]);

  // Now-line position — after the last row whose time has passed. Hook must
  // be called before any early return.
  const now = useSyncExternalStore(tlSubscribe, tlGetNow, () => 0);

  if (rows.length === 0) {
    return (
      <div className="hub-timeline-empty">
        <Sparkles size={16} aria-hidden style={{ color: "var(--text-subtle)" }} />
        <p className="text-sm" style={{ color: "var(--text-muted)", margin: 0 }}>
          Nothing scheduled today yet.
        </p>
        <p className="text-xs" style={{ color: "var(--text-subtle)", margin: 0 }}>
          Add a task above, or connect Calendar/Jira from <Link href="/setup">Setup</Link>.
        </p>
      </div>
    );
  }

  let nowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].time !== null && (rows[i].time as number) <= now) nowIndex = i;
  }

  return (
    <ol className="hub-timeline" aria-label="Today's timeline">
      {rows.map((r, i) => (
        <li key={r.id} className="hub-timeline-row">
          <div className="hub-timeline-time">
            {r.time === null ? "—" : formatTime(r.time)}
          </div>
          <div
            className="hub-timeline-marker"
            style={{ background: r.color, boxShadow: `0 0 0 3px color-mix(in oklab, ${r.color} 22%, transparent)` }}
            aria-hidden
          >
            {r.icon}
          </div>
          <div className="hub-timeline-body">
            {r.href ? (
              <a
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hub-timeline-title"
              >
                {r.title}
              </a>
            ) : (
              <span className="hub-timeline-title">{r.title}</span>
            )}
            {r.meta && <span className="hub-timeline-meta">{r.meta}</span>}
          </div>
          {i === nowIndex && (
            <div className="hub-timeline-now" aria-label="Now">
              now
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
