import { createGoogleCalendar } from "../domains/calendar/google";
import { readDashboardEnvLocalFile, resolveEnvValue } from "./dashboard-env-local";
import { hasSavedCalendarSelection, readCalendarSelection } from "./calendar-selection";

export type { CalendarPerson, CalendarEvent, GoogleCalendarInfo } from "../../../../packages/shared/calendar/types";
export const { isGoogleCalendarAuthError, getResolvedGoogleCalendarEnv, googleCalendarOAuthCallbackUrl, isGoogleCalendarConfigured, resolveActiveCalendarIds, dedupeCalendarEvents, listCalendars, getTodayEvents, getWeekEvents, getEventsInRange, getAuthUrl, exchangeCode } = createGoogleCalendar({ readDashboardEnvLocalFile, resolveEnvValue, hasSavedCalendarSelection, readCalendarSelection });
