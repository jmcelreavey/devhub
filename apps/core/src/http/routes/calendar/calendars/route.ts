import { calendarSelect, calendarSelectInput } from "../../../../../../../packages/shared/actions/calendar";
import { calendarList } from "../../../../../../../packages/shared/actions/calendar";
import { invalidateCalendarCaches } from "@devhub/core/calendar/cache";
import { writeCalendarSelection } from "../../../../lib/calendar-selection";
import { notConfigured, parseBody } from "../../../../lib/api-utils";
import {
  isGoogleCalendarAuthError,
  isGoogleCalendarConfigured,
  listCalendars,
  resolveActiveCalendarIds,
} from "../../../../lib/google-calendar";


export async function GET() {
  return await calendarList.handler({}, { execute: async () => {
    if (!isGoogleCalendarConfigured()) {
      return Response.json({ configured: false, calendars: [], selectedIds: [] });
    }

    try {
      const calendars = await listCalendars();
      const selectedIds = resolveActiveCalendarIds(calendars);
      return Response.json({ configured: true, calendars, selectedIds });
    } catch (e) {
      // Token present but rejected (revoked/expired) → surface as "reconnect"
      // rather than a 500, so the calendar picker can prompt a re-auth.
      if (isGoogleCalendarAuthError(e)) {
        return Response.json({ configured: false, calendars: [], selectedIds: [], needsReauth: true });
      }
      return Response.json(
        { error: e instanceof Error ? e.message : "Failed to list calendars" },
        { status: 500 },
      );
    }
  } }) as Response;
}


const SaveCalendarsSchema = calendarSelectInput;

export async function POST(req: Request) {
  if (!isGoogleCalendarConfigured()) {
    return notConfigured("Calendar");
  }

  const parsed = await parseBody(req, SaveCalendarsSchema);
  if (!parsed.ok) return parsed.response;


  return await calendarSelect.handler(parsed.data, { execute: async () => {
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
      return Response.json({ ok: true, selectedIds });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Failed to save calendar selection" },
        { status: 500 },
      );
    }
  } }) as Response;
}
