import { NextRequest, NextResponse } from "next/server";
import { invalidateCalendarCaches } from "@/lib/calendar-cache";
import { writeCalendarSelection } from "@/lib/calendar-selection";
import { z } from "zod";
import { notConfigured, parseBody } from "@/lib/api-utils";
import {
  isGoogleCalendarAuthError,
  isGoogleCalendarConfigured,
  listCalendars,
  resolveActiveCalendarIds,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ configured: false, calendars: [], selectedIds: [] });
  }

  try {
    const calendars = await listCalendars();
    const selectedIds = resolveActiveCalendarIds(calendars);
    return NextResponse.json({ configured: true, calendars, selectedIds });
  } catch (e) {
    // Token present but rejected (revoked/expired) → surface as "reconnect"
    // rather than a 500, so the calendar picker can prompt a re-auth.
    if (isGoogleCalendarAuthError(e)) {
      return NextResponse.json({ configured: false, calendars: [], selectedIds: [], needsReauth: true });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list calendars" },
      { status: 500 },
    );
  }
}


const SaveCalendarsSchema = z.object({
  calendarIds: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  if (!isGoogleCalendarConfigured()) {
    return notConfigured("Calendar");
  }

  const parsed = await parseBody(req, SaveCalendarsSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const calendars = await listCalendars();
    const known = new Set(calendars.map((c) => c.id));
    // Schema guarantees an array of strings; this still filters to calendars
    // that actually exist, which is an authorisation check rather than a shape
    // check and so stays here.
    const selectedIds = await writeCalendarSelection(
      parsed.data.calendarIds.filter((id) => known.has(id)),
    );
    invalidateCalendarCaches();
    return NextResponse.json({ ok: true, selectedIds });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save calendar selection" },
      { status: 500 },
    );
  }
}
