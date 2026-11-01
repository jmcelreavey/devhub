let todayCache: { events: unknown[]; ts: number } | null = null;
let weekCache: { data: unknown; ts: number } | null = null;

export const CALENDAR_TODAY_TTL_MS = 5 * 60 * 1000;
export const CALENDAR_WEEK_TTL_MS = 10 * 60 * 1000;

export function getTodayCalendarCache(): { events: unknown[]; ts: number } | null {
  return todayCache;
}

export function setTodayCalendarCache(events: unknown[]): void {
  todayCache = { events, ts: Date.now() };
}

export function getWeekCalendarCache(): { data: unknown; ts: number } | null {
  return weekCache;
}

export function setWeekCalendarCache(data: unknown): void {
  weekCache = { data, ts: Date.now() };
}

export function invalidateCalendarCaches(): void {
  todayCache = null;
  weekCache = null;
}
