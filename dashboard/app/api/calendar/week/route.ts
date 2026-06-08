import { NextResponse } from "next/server";
import {
  CALENDAR_WEEK_TTL_MS,
  getWeekCalendarCache,
  setWeekCalendarCache,
} from "@/lib/calendar-cache";
import { getWeekEvents } from "@/lib/google-calendar";

export async function GET() {
  const cache = getWeekCalendarCache();
  if (cache && Date.now() - cache.ts < CALENDAR_WEEK_TTL_MS) {
    return NextResponse.json({ days: cache.data, cached: true });
  }

  try {
    const data = await getWeekEvents();
    setWeekCalendarCache(data);
    return NextResponse.json({ days: data, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Calendar fetch failed" },
      { status: 500 }
    );
  }
}
