import { calendarWeek } from "../../../../../../../packages/shared/actions/calendar";
import {
  CALENDAR_WEEK_TTL_MS,
  getWeekCalendarCache,
  setWeekCalendarCache,
} from "@devhub/core/calendar/cache";
import { getWeekEvents, isGoogleCalendarAuthError } from "../../../../lib/google-calendar";

export async function GET() {
  return await calendarWeek.handler({}, { execute: async () => {
    const cache = getWeekCalendarCache();
    if (cache && Date.now() - cache.ts < CALENDAR_WEEK_TTL_MS) {
      return Response.json({ days: cache.data, cached: true });
    }

    try {
      const data = await getWeekEvents();
      setWeekCalendarCache(data);
      return Response.json({ days: data, cached: false });
    } catch (e) {
      // Missing/expired refresh token → reconnect hint, not a 500.
      if (isGoogleCalendarAuthError(e)) {
        return Response.json({ days: {}, cached: false, needsReauth: true });
      }
      return Response.json(
        { error: e instanceof Error ? e.message : "Calendar fetch failed" },
        { status: 500 }
      );
    }
  } }) as Response;
}
