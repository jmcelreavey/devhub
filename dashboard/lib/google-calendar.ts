import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { hasSavedCalendarSelection, readCalendarSelection } from "@/lib/calendar-selection";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  conferenceUrl?: string;
  /** Link to the event in Google Calendar. */
  htmlLink?: string;
  /** Attendee email addresses, if any. */
  attendees?: string[];
  /** Source calendar ID (for merged multi-calendar views). */
  calendarId?: string;
  /** Human-readable calendar name. */
  calendarName?: string;
  /** Google calendar color (hex). */
  calendarColor?: string;
  /** Stable UID for deduping the same event across calendars. */
  iCalUID?: string;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  /** Whether this calendar is checked in Google Calendar UI. */
  selected?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

function defaultOAuthRedirectUri(): string {
  return `http://localhost:${process.env.PORT ?? "1337"}/api/calendar/auth/callback`;
}

/** Resolve Google OAuth + Calendar env: `.env.local` wins over stale `process.env`. */
export function getResolvedGoogleCalendarEnv(): {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  oauthRedirectUri?: string;
} {
  const { overrides } = readDashboardEnvLocalFile();
  return {
    clientId: resolveEnvValue("GOOGLE_CLIENT_ID", overrides),
    clientSecret: resolveEnvValue("GOOGLE_CLIENT_SECRET", overrides),
    refreshToken: resolveEnvValue("GOOGLE_REFRESH_TOKEN", overrides),
    oauthRedirectUri: resolveEnvValue("GOOGLE_OAUTH_REDIRECT_URI", overrides),
  };
}

/**
 * Google OAuth rejects `0.0.0.0` as a redirect host (it is a bind address, not a usable callback URL).
 * When the dashboard is opened via `http://0.0.0.0:PORT`, rewrite to `localhost` so the redirect URI
 * matches a typical "Web client" entry like `http://localhost:1337/api/calendar/auth/callback`.
 */
export function googleCalendarOAuthCallbackUrl(requestOrigin: string): string {
  let base = requestOrigin.replace(/\/$/, "");
  try {
    const u = new URL(base);
    if (u.hostname === "0.0.0.0") {
      u.hostname = "localhost";
      base = u.origin;
    }
  } catch {
    /* keep base as trimmed string */
  }
  return `${base}/api/calendar/auth/callback`;
}

function getOAuthClient() {
  const { clientId, clientSecret, refreshToken, oauthRedirectUri } = getResolvedGoogleCalendarEnv();
  if (!clientId || !clientSecret || !refreshToken) return null;

  const redirect = oauthRedirectUri ?? defaultOAuthRedirectUri();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirect);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

export function isGoogleCalendarConfigured(): boolean {
  const { clientId, clientSecret, refreshToken } = getResolvedGoogleCalendarEnv();
  return !!(clientId && clientSecret && refreshToken);
}

function toEvent(
  e: calendar_v3.Schema$Event,
  meta?: { calendarId: string; calendarName: string; calendarColor?: string },
): CalendarEvent {
  const start = e.start?.dateTime ?? e.start?.date ?? "";
  const end = e.end?.dateTime ?? e.end?.date ?? "";
  const isAllDay = !!e.start?.date;
  const calendarId = meta?.calendarId;
  const rawId = e.id ?? "";
  return {
    id: calendarId ? `${calendarId}::${rawId}` : rawId,
    title: e.summary ?? "(No title)",
    start,
    end,
    isAllDay,
    location: e.location ?? undefined,
    conferenceUrl: e.conferenceData?.entryPoints?.[0]?.uri ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
    attendees: e.attendees?.map((a) => a.email ?? "").filter(Boolean),
    calendarId,
    calendarName: meta?.calendarName,
    calendarColor: meta?.calendarColor,
    iCalUID: e.iCalUID ?? undefined,
  };
}

function toCalendarInfo(item: calendar_v3.Schema$CalendarListEntry): GoogleCalendarInfo | null {
  const id = item.id?.trim();
  if (!id) return null;
  return {
    id,
    summary: item.summary?.trim() || id,
    primary: item.primary ?? undefined,
    selected: item.selected ?? undefined,
    backgroundColor: item.backgroundColor ?? undefined,
    accessRole: item.accessRole ?? undefined,
  };
}

/** Pick which calendar IDs to fetch events from. */
export function resolveActiveCalendarIds(allCalendars: GoogleCalendarInfo[]): string[] {
  const byId = new Map(allCalendars.map((c) => [c.id, c]));
  const saved = readCalendarSelection();
  if (hasSavedCalendarSelection()) {
    const valid = saved.filter((id) => byId.has(id));
    if (valid.length > 0) return valid;
  }

  const googleSelected = allCalendars.filter((c) => c.selected).map((c) => c.id);
  if (googleSelected.length > 0) return googleSelected;

  const primary = allCalendars.find((c) => c.primary);
  return [primary?.id ?? "primary"];
}

/** Drop duplicate events that appear on multiple selected calendars. */
export function dedupeCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const event of events) {
    const key = event.iCalUID ?? event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function sortEventsByStart(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => a.start.localeCompare(b.start));
}

export async function listCalendars(): Promise<GoogleCalendarInfo[]> {
  if (!isGoogleCalendarConfigured()) return [];
  const auth = getOAuthClient();
  if (!auth) return [];

  const cal = google.calendar({ version: "v3", auth });
  const res = await cal.calendarList.list({ minAccessRole: "reader" });
  return (res.data.items ?? [])
    .map(toCalendarInfo)
    .filter((item): item is GoogleCalendarInfo => item !== null);
}

async function fetchEventsForCalendars(
  cal: calendar_v3.Calendar,
  calendarIds: string[],
  calendarsById: Map<string, GoogleCalendarInfo>,
  timeMin: string,
  timeMax: string,
  maxResults: number,
): Promise<CalendarEvent[]> {
  const chunks = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const meta = calendarsById.get(calendarId);
      try {
        const res = await cal.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults,
        });
        return (res.data.items ?? []).map((e) =>
          toEvent(e, {
            calendarId,
            calendarName: meta?.summary ?? calendarId,
            calendarColor: meta?.backgroundColor,
          }),
        );
      } catch (err) {
        console.error(`[google-calendar] failed to fetch events for ${calendarId}:`, err);
        return [];
      }
    }),
  );
  return sortEventsByStart(dedupeCalendarEvents(chunks.flat()));
}

export async function getTodayEvents(): Promise<CalendarEvent[]> {
  if (!isGoogleCalendarConfigured()) return [];
  const auth = getOAuthClient();
  if (!auth) return [];

  const cal = google.calendar({ version: "v3", auth });
  const allCalendars = await listCalendars();
  const calendarIds = resolveActiveCalendarIds(allCalendars);
  const calendarsById = new Map(allCalendars.map((c) => [c.id, c]));

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  return fetchEventsForCalendars(
    cal,
    calendarIds,
    calendarsById,
    startOfDay.toISOString(),
    endOfDay.toISOString(),
    50,
  );
}

export async function getWeekEvents(): Promise<Record<string, CalendarEvent[]>> {
  if (!isGoogleCalendarConfigured()) return {};
  const auth = getOAuthClient();
  if (!auth) return {};

  const cal = google.calendar({ version: "v3", auth });
  const allCalendars = await listCalendars();
  const calendarIds = resolveActiveCalendarIds(allCalendars);
  const calendarsById = new Map(allCalendars.map((c) => [c.id, c]));

  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

  const events = await fetchEventsForCalendars(
    cal,
    calendarIds,
    calendarsById,
    startOfWeek.toISOString(),
    endOfWeek.toISOString(),
    100,
  );

  const grouped: Record<string, CalendarEvent[]> = {};
  for (const e of events) {
    const dateStr = e.start.slice(0, 10);
    if (!dateStr) continue;
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(e);
  }
  return grouped;
}

/** Google OAuth authorize URL (`redirectUri` must match the callback route and GCP credential config). */
export function getAuthUrl(redirectUri: string): string | null {
  const { clientId, clientSecret } = getResolvedGoogleCalendarEnv();
  if (!clientId || !clientSecret) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    prompt: "consent",
  });
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const { clientId, clientSecret } = getResolvedGoogleCalendarEnv();
  if (!clientId || !clientSecret) throw new Error("Missing Google credentials");

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) throw new Error("No refresh token returned");
  return tokens.refresh_token;
}
