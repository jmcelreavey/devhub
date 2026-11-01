import { z } from "zod";
import { defineAction } from "./define.ts";

interface CalendarContext<Input> { execute: (input: Input) => unknown }

export const calendarWeekInput = z.object({});
export const calendarWeek = defineAction<typeof calendarWeekInput, CalendarContext<z.output<typeof calendarWeekInput>>, unknown>({
  input: calendarWeekInput,
  http: {"method":"GET","path":"/api/calendar/week"},
  mcp: { name: "calendar_week", toolset: "calendar", description: "This week's Google Calendar events, grouped by day, from the DevHub dashboard. Requires the dashboard running and Google Calendar configured in /setup." },
  handler: (input, context) => context.execute(input),
});

export const calendarListInput = z.object({});
export const calendarList = defineAction<typeof calendarListInput, CalendarContext<z.output<typeof calendarListInput>>, unknown>({
  input: calendarListInput,
  http: {"method":"GET","path":"/api/calendar/calendars"},
  mcp: { name: "calendar_list", toolset: "calendar", description: "List the Google Calendars available to the dashboard and which are selected. Requires the dashboard running and Google Calendar configured." },
  handler: (input, context) => context.execute(input),
});

export const calendarSelectInput = z.object({ calendarIds: z.array(z.string()) });
export const calendarSelect = defineAction<typeof calendarSelectInput, CalendarContext<z.output<typeof calendarSelectInput>>, unknown>({
  input: calendarSelectInput,
  http: { method: "POST", path: "/api/calendar/calendars" },
  mcp: { reason: "Calendar selection is a local account preference; MCP tools read the selected calendars only." },
  handler: (input, context) => context.execute(input),
});

export const calendarTodayInput = z.object({});
export const calendarToday = defineAction<typeof calendarTodayInput, CalendarContext<z.output<typeof calendarTodayInput>>, unknown>({
  input: calendarTodayInput,
  http: { method: "GET", path: "/api/calendar" },
  mcp: { reason: "The dashboard's today widget has a distinct cache; calendar_week returns the full week to MCP." },
  handler: (input, context) => context.execute(input),
});

export const calendarAuthUrlInput = z.object({ origin: z.string() });
export const calendarAuthUrl = defineAction<typeof calendarAuthUrlInput, CalendarContext<z.output<typeof calendarAuthUrlInput>>, unknown>({
  input: calendarAuthUrlInput,
  http: { method: "GET", path: "/api/calendar/auth" },
  mcp: { reason: "Account authorisation URLs are browser setup state, not agent actions." },
  handler: (input, context) => context.execute(input),
});

export const calendarAuthStartInput = z.object({ origin: z.string() });
export const calendarAuthStart = defineAction<typeof calendarAuthStartInput, CalendarContext<z.output<typeof calendarAuthStartInput>>, unknown>({
  input: calendarAuthStartInput,
  http: { method: "GET", path: "/api/calendar/auth/start" },
  mcp: { reason: "Account authorisation uses a browser redirect; never exposed as an MCP tool." },
  handler: (input, context) => context.execute(input),
});

export const calendarAuthCallbackInput = z.object({ origin: z.string(), code: z.string().nullable() });
export const calendarAuthCallback = defineAction<typeof calendarAuthCallbackInput, CalendarContext<z.output<typeof calendarAuthCallbackInput>>, unknown>({
  input: calendarAuthCallbackInput,
  http: { method: "GET", path: "/api/calendar/auth/callback" },
  mcp: { reason: "The OAuth browser callback exchanges a code and stores credentials locally; never exposed to agents." },
  handler: (input, context) => context.execute(input),
});
