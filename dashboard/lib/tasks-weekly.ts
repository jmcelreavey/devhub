import type { Task, TaskDay } from "./tasks-storage";

export interface WeeklyDayStat {
  date: string;
  created: number;
  completed: number;
  abandoned: number;
  moved: number;
}

export interface WeeklySlip {
  text: string;
  jiraKey?: string;
  /** Distinct days within the window this task rolled over (moved). */
  movedCount: number;
}

export interface WeeklyReview {
  start: string;
  end: string;
  days: WeeklyDayStat[];
  totals: { created: number; completed: number; abandoned: number; moved: number };
  slipped: WeeklySlip[];
}

/** Tasks rolled over on this many distinct days count as "slipping". */
export const SLIP_THRESHOLD = 3;

const WINDOW_DAYS = 7;

function shiftISODate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Ascending list of the 7 calendar dates ending at (and including) `end`. */
export function weekWindow(end: string): string[] {
  const dates: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    dates.push(shiftISODate(end, -i));
  }
  return dates;
}

function emptyDayStat(date: string): WeeklyDayStat {
  return { date, created: 0, completed: 0, abandoned: 0, moved: 0 };
}

function statForTasks(date: string, tasks: Task[]): WeeklyDayStat {
  return {
    date,
    created: tasks.length,
    completed: tasks.filter((t) => t.done).length,
    abandoned: tasks.filter((t) => !!t.abandonedAt).length,
    moved: tasks.filter((t) => !!t.movedAt).length,
  };
}

/**
 * Aggregate a 7-day task window. Rollover mints a new id each day, so a slipping
 * task is detected by its (normalised) text appearing as `moved` across days.
 */
export function buildWeeklyReview(days: TaskDay[], end: string): WeeklyReview {
  const window = weekWindow(end);
  const byDate = new Map(days.map((d) => [d.date, d]));

  const dayStats = window.map((date) => {
    const day = byDate.get(date);
    return day ? statForTasks(date, day.tasks) : emptyDayStat(date);
  });

  const totals = dayStats.reduce(
    (acc, d) => ({
      created: acc.created + d.created,
      completed: acc.completed + d.completed,
      abandoned: acc.abandoned + d.abandoned,
      moved: acc.moved + d.moved,
    }),
    { created: 0, completed: 0, abandoned: 0, moved: 0 },
  );

  const movedByText = new Map<string, { text: string; jiraKey?: string; days: Set<string> }>();
  for (const date of window) {
    const tasks = byDate.get(date)?.tasks ?? [];
    for (const t of tasks) {
      if (!t.movedAt) continue;
      const normalized = t.text.trim().toLowerCase();
      if (!normalized) continue;
      const entry = movedByText.get(normalized) ?? { text: t.text.trim(), jiraKey: t.jiraKey, days: new Set<string>() };
      entry.days.add(date);
      if (!entry.jiraKey && t.jiraKey) entry.jiraKey = t.jiraKey;
      movedByText.set(normalized, entry);
    }
  }

  const slipped: WeeklySlip[] = [...movedByText.values()]
    .filter((e) => e.days.size >= SLIP_THRESHOLD)
    .map((e) => ({ text: e.text, jiraKey: e.jiraKey, movedCount: e.days.size }))
    .sort((a, b) => b.movedCount - a.movedCount || a.text.localeCompare(b.text));

  return { start: window[0]!, end: window[window.length - 1]!, days: dayStats, totals, slipped };
}
