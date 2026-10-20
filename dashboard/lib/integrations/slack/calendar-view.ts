import type { KnownBlock } from "@slack/web-api";
import type { SlackMessage } from "./client";
import { escapeSlackText, slackContext, slackDashboardUrl, slackLine, slackLink, slackOpenButton, slackTextMessage } from "./format";
import type { CalendarEvent } from "@/lib/google-calendar";

/** Most events one card lists; the rest wait in DevHub. */
export const CALENDAR_LIMIT = 8;
const DEFAULT_ZONE = "Europe/London";

export type SlackCalendarData =
  | { state: "ok"; events: CalendarEvent[] }
  | { state: "not-configured" | "needs-reauth" };

/** DevHub's day files use the machine's local time, so times show in the machine's zone (London unless the Mac says otherwise). */
export function slackTimeZone(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const wanted = env.DEVHUB_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_ZONE;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: wanted }); return wanted; } catch { return DEFAULT_ZONE; }
}

function dayIn(zone: string, instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function timeIn(zone: string, instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(instant);
}

/** All-day events come as plain dates (end exclusive); timed ones as instants with an offset. */
export function eventsOnDay(events: readonly CalendarEvent[], day: string, zone: string): CalendarEvent[] {
  return events.filter((event) => event.isAllDay
    ? event.start.slice(0, 10) <= day && day < event.end.slice(0, 10)
    : dayIn(zone, new Date(event.start)) === day)
    .sort((a, b) => Number(b.isAllDay) - Number(a.isAllDay) || a.start.localeCompare(b.start));
}

/** The event running now, else the soonest one still to start. All-day events are never "the next meeting". */
export function nextEvent(events: readonly CalendarEvent[], now: number): CalendarEvent | undefined {
  return events.filter((event) => !event.isAllDay && Date.parse(event.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
}

export function describeWait(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function when(event: CalendarEvent, zone: string): string {
  return event.isAllDay ? "All day" : `${timeIn(zone, new Date(event.start))}–${timeIn(zone, new Date(event.end))}`;
}

function joinUrl(event: CalendarEvent): string | undefined {
  try {
    const url = new URL(event.conferenceUrl ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}

function eventBlock(event: CalendarEvent, zone: string): KnownBlock {
  const join = joinUrl(event);
  const tail = [join ? slackLink("Join", join) : undefined, event.location && !join ? escapeSlackText(slackLine(event.location, 80)) : undefined].filter(Boolean).join(" · ");
  return { type: "section", text: { type: "mrkdwn", text: `*${escapeSlackText(when(event, zone))}* ${slackLink(event.title, event.htmlLink)}${tail ? `\n${tail}` : ""}`, verbatim: true } };
}

function dayLabel(day: string, today: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(Date.UTC(year, month - 1, date)));
  return day === today ? `Today · ${label}` : label;
}

function unavailable(data: Exclude<SlackCalendarData, { state: "ok" }>, channel: string, threadTs?: string): SlackMessage {
  const text = data.state === "needs-reauth" ? "Google Calendar needs reconnecting. Open DevHub to sign in again." : "Google Calendar isn't connected yet. Set it up in DevHub.";
  return slackTextMessage(channel, text, threadTs, [{ type: "section", text: { type: "plain_text", text } }, slackOpenButton(slackDashboardUrl("/setup"))]);
}

export function formatCalendarDay(input: { data: SlackCalendarData; day: string; channel: string; threadTs?: string; now?: number; zone?: string }): SlackMessage {
  if (input.data.state !== "ok") return unavailable(input.data, input.channel, input.threadTs);
  const zone = input.zone ?? slackTimeZone();
  const now = input.now ?? Date.now();
  const events = eventsOnDay(input.data.events, input.day, zone);
  const title = `Calendar · ${dayLabel(input.day, dayIn(zone, new Date(now)))}`;
  const shown = events.slice(0, CALENDAR_LIMIT);
  const blocks: KnownBlock[] = [{ type: "header", text: { type: "plain_text", text: title } }];
  const fallback = [title];
  if (!events.length) { blocks.push({ type: "section", text: { type: "plain_text", text: "No meetings." } }); fallback.push("No meetings."); }
  for (const event of shown) { blocks.push(eventBlock(event, zone)); fallback.push(`${when(event, zone)} ${slackLine(event.title, 120)}`); }
  if (events.length > shown.length) { blocks.push(slackContext(`+${events.length - shown.length} more in DevHub`)); fallback.push(`+${events.length - shown.length} more in DevHub`); }
  blocks.push(slackContext(`Times in ${zone}.`));
  blocks.push(slackOpenButton(slackDashboardUrl("/calendar")));
  return slackTextMessage(input.channel, fallback.join("\n"), input.threadTs, blocks);
}

export function formatNextMeeting(input: { data: SlackCalendarData; channel: string; threadTs?: string; now?: number; zone?: string }): SlackMessage {
  if (input.data.state !== "ok") return unavailable(input.data, input.channel, input.threadTs);
  const zone = input.zone ?? slackTimeZone();
  const now = input.now ?? Date.now();
  const event = nextEvent(input.data.events, now);
  if (!event) {
    const text = "No more meetings in the next week.";
    return slackTextMessage(input.channel, text, input.threadTs, [{ type: "section", text: { type: "plain_text", text } }, slackOpenButton(slackDashboardUrl("/calendar"))]);
  }
  const running = Date.parse(event.start) <= now;
  const timing = running ? `Now · ends in ${describeWait(Date.parse(event.end) - now)}` : `in ${describeWait(Date.parse(event.start) - now)}`;
  const join = joinUrl(event);
  const line = `${when(event, zone)} · ${timing}`;
  const blocks: KnownBlock[] = [
    { type: "header", text: { type: "plain_text", text: "Next meeting" } },
    { type: "section", text: { type: "mrkdwn", text: `${slackLink(event.title, event.htmlLink)}\n${escapeSlackText(line)}`, verbatim: true } },
    // One action: Join when there is a link, otherwise open the calendar.
    join ? { type: "actions", elements: [{ type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "Join" }, style: "primary", url: join }] } : slackOpenButton(slackDashboardUrl("/calendar")),
  ];
  return slackTextMessage(input.channel, `Next meeting: ${slackLine(event.title, 120)} ${line}`, input.threadTs, blocks);
}
