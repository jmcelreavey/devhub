import { CALENDAR_WEEK_TTL_MS, getWeekCalendarCache, setWeekCalendarCache } from "@/lib/calendar-cache";
import { getWeekEvents, isGoogleCalendarAuthError, isGoogleCalendarConfigured, type CalendarEvent } from "@/lib/google-calendar";
import type { SlackCalendarData } from "./calendar-view";

/** The next seven days of events, from the same cache the calendar page uses. */
export async function loadSlackCalendar(): Promise<SlackCalendarData> {
  if (!isGoogleCalendarConfigured()) return { state: "not-configured" };
  const cache = getWeekCalendarCache();
  let days: Record<string, CalendarEvent[]>;
  if (cache && Date.now() - cache.ts < CALENDAR_WEEK_TTL_MS) days = cache.data as Record<string, CalendarEvent[]>;
  else {
    try { days = await getWeekEvents(); setWeekCalendarCache(days); }
    catch (error) {
      if (isGoogleCalendarAuthError(error)) return { state: "needs-reauth" };
      throw error;
    }
  }
  return { state: "ok", events: Object.values(days).flat() };
}
