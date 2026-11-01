import { calendarToday } from "../../../../../../packages/shared/actions/calendar";
import { withErrorHandler } from "../../../lib/api-utils";
import {
  CALENDAR_TODAY_TTL_MS,
  getTodayCalendarCache,
  setTodayCalendarCache,
} from "@devhub/core/calendar/cache";
import { getTodayEvents, isGoogleCalendarAuthError } from "../../../lib/google-calendar";

export const GET = withErrorHandler<[request: Request]>(async () => {
  return await calendarToday.handler({}, { execute: async () => {
    const cache = getTodayCalendarCache();
    if (cache && Date.now() - cache.ts < CALENDAR_TODAY_TTL_MS) {
      return Response.json({ events: cache.events, cached: true });
    }

    try {
      const events = await getTodayEvents();
      setTodayCalendarCache(events);
      return Response.json({ events, cached: false });
    } catch (e) {
      // A missing/expired refresh token is a setup problem, not a server fault —
      // return empty events with a reconnect hint so the dashboard stays usable.
      if (isGoogleCalendarAuthError(e)) {
        return Response.json({ events: [], cached: false, needsReauth: true });
      }
      return Response.json(
        { error: e instanceof Error ? e.message : "Calendar fetch failed" },
        { status: 500 }
      );
    }
  } }) as Response;
}, "calendar.get");
