import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/api-utils";
import { invalidateCalendarCaches } from "@/lib/calendar-cache";
import { writeCalendarSelection } from "@/lib/calendar-selection";
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

interface SaveBody {
  calendarIds?: string[];
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ error: "Calendar not configured" }, { status: 400 });
  }

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.calendarIds)) {
    return NextResponse.json({ error: "calendarIds must be an array" }, { status: 400 });
  }

  try {
    const calendars = await listCalendars();
    const known = new Set(calendars.map((c) => c.id));
    const selectedIds = await writeCalendarSelection(
      body.calendarIds.filter((id) => typeof id === "string" && known.has(id)),
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
