import { NextResponse } from "next/server";
import {
  CALENDAR_TODAY_TTL_MS,
  getTodayCalendarCache,
  setTodayCalendarCache,
} from "@/lib/calendar-cache";
import { getTodayEvents, isGoogleCalendarAuthError } from "@/lib/google-calendar";

export async function GET() {
  const cache = getTodayCalendarCache();
  if (cache && Date.now() - cache.ts < CALENDAR_TODAY_TTL_MS) {
    return NextResponse.json({ events: cache.events, cached: true });
  }

  try {
    const events = await getTodayEvents();
    setTodayCalendarCache(events);
    return NextResponse.json({ events, cached: false });
  } catch (e) {
    // A missing/expired refresh token is a setup problem, not a server fault —
    // return empty events with a reconnect hint so the dashboard stays usable.
    if (isGoogleCalendarAuthError(e)) {
      return NextResponse.json({ events: [], cached: false, needsReauth: true });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Calendar fetch failed" },
      { status: 500 }
    );
  }
}
