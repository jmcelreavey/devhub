/**
 * The day plan: what the calendar has already spent, what's left, and which of
 * today's open tasks plausibly fit in the gaps.
 *
 * Covers two roadmap items that turned out to be the same shape:
 *   R4 — "the briefing engine, calendar and task list all exist and don't talk
 *        to each other". This is the wiring.
 *   R2 — the remaining half: surface "this failed at 3am" instead of losing it
 *        to a toast nobody saw.
 *
 * Everything here is *arithmetic*, not advice. The briefing canvas is authored
 * by a model, and the house rule (see briefing-taste.ts) is that the model gets
 * facts and does the prose. If this module started emitting sentences they'd be
 * duplicated, contradicted, or both.
 */
import { getTodayEvents, type CalendarEvent } from "@/lib/google-calendar";
import { getTasks, isTaskOpen, type Task } from "@/lib/tasks/storage";
import { listRecentFailures, type RunHistoryRow } from "@/lib/run-history";

/** Working day bounds, local time, used to bound "free" time. */
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 17.5;

export interface FreeWindow {
  /** Minutes past midnight, local. */
  startMin: number;
  endMin: number;
  durationMin: number;
}

export interface DayPlan {
  /** Timed (non-all-day) meetings today. */
  meetingCount: number;
  /** Total timed meeting minutes, overlaps counted once. */
  meetingMinutes: number;
  /** All-day entries — holidays, OOO — which aren't "meeting load". */
  allDayTitles: string[];
  /** Unbooked stretches inside working hours, longest first. */
  freeWindows: FreeWindow[];
  freeMinutes: number;
  /** Longest single uninterrupted stretch — the only one deep work fits in. */
  longestFreeMin: number;
  /** Open tasks for today, in list order. */
  openTasks: { id: string; text: string; due?: string }[];
  /**
   * How many open tasks could fit end-to-end in the free windows, assuming a
   * nominal cost per task. Deliberately crude: the point is "two, not nine".
   */
  tasksThatFit: number;
  /** Runs that failed recently — the "it broke at 3am" channel. */
  recentFailures: { script: string; exitCode?: number; startedAt: number }[];
}

/** Nominal minutes to assume a task costs when nothing better is known. */
export const NOMINAL_TASK_MIN = 45;

function toMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Merges overlapping/adjacent intervals. Double-booked calendars are normal and
 * naive summing reports six hours of meetings in a four-hour day.
 */
export function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Gaps inside the working window that no meeting covers. */
export function freeWindowsFrom(
  busy: [number, number][],
  startMin = WORK_START_HOUR * 60,
  endMin = Math.round(WORK_END_HOUR * 60),
): FreeWindow[] {
  const merged = mergeIntervals(busy);
  const windows: FreeWindow[] = [];
  let cursor = startMin;
  for (const [s, e] of merged) {
    if (e <= startMin || s >= endMin) continue;
    const clampedStart = Math.max(s, startMin);
    if (clampedStart > cursor) {
      windows.push({ startMin: cursor, endMin: clampedStart, durationMin: clampedStart - cursor });
    }
    cursor = Math.max(cursor, Math.min(e, endMin));
  }
  if (cursor < endMin) {
    windows.push({ startMin: cursor, endMin, durationMin: endMin - cursor });
  }
  // Longest first: the briefing cares about where deep work could go.
  return windows.sort((a, b) => b.durationMin - a.durationMin);
}

/** Pure core, so the arithmetic is testable without Google or the filesystem. */
export function computeDayPlan(
  events: CalendarEvent[],
  tasks: Task[],
  failures: RunHistoryRow[],
): DayPlan {
  const timed = events.filter((e) => !e.isAllDay);
  const busy: [number, number][] = timed.map((e) => [toMinutes(e.start), toMinutes(e.end)]);
  const merged = mergeIntervals(busy);
  const meetingMinutes = merged.reduce((sum, [s, e]) => sum + (e - s), 0);

  const freeWindows = freeWindowsFrom(busy);
  const freeMinutes = freeWindows.reduce((sum, w) => sum + w.durationMin, 0);

  const openTasks = tasks.filter(isTaskOpen).map((t) => ({ id: t.id, text: t.text, due: t.due }));

  // Fit tasks into windows greedily, largest window first. A task can't span a
  // meeting, so this counts per-window capacity rather than dividing total time.
  let remaining = openTasks.length;
  let fitted = 0;
  for (const w of freeWindows) {
    if (remaining <= 0) break;
    const capacity = Math.floor(w.durationMin / NOMINAL_TASK_MIN);
    const take = Math.min(capacity, remaining);
    fitted += take;
    remaining -= take;
  }

  return {
    meetingCount: timed.length,
    meetingMinutes,
    allDayTitles: events.filter((e) => e.isAllDay).map((e) => e.title),
    freeWindows,
    freeMinutes,
    longestFreeMin: freeWindows[0]?.durationMin ?? 0,
    openTasks,
    tasksThatFit: fitted,
    recentFailures: failures.map((f) => ({
      script: f.script,
      exitCode: f.exitCode,
      startedAt: f.startedAt,
    })),
  };
}

/**
 * IO wrapper. Every source is optional by design — the briefing must render
 * when Google is unauthorised, when there are no tasks, and when nothing has
 * ever run. A day plan is a nice-to-have, not a precondition.
 */
export async function buildDayPlan(date?: string): Promise<DayPlan> {
  const events = await getTodayEvents().catch(() => [] as CalendarEvent[]);
  let tasks: Task[] = [];
  try {
    tasks = getTasks(date);
  } catch {
    tasks = [];
  }
  let failures: RunHistoryRow[] = [];
  try {
    failures = listRecentFailures(5);
  } catch {
    failures = [];
  }
  return computeDayPlan(events, tasks, failures);
}

/** "3h 20m" / "45m" — used in the prompt projection, not the UI. */
export function formatMinutes(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "09:30" from minutes-past-midnight. */
export function formatClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
