import { describe, expect, it } from "vitest";
import { describeWait, eventsOnDay, formatCalendarDay, formatNextMeeting, nextEvent, slackTimeZone } from "./calendar-view";

const event = (title: string, start: string, end: string, patch: Record<string, unknown> = {}) => ({ id: title, title, start, end, isAllDay: false, ...patch });
const LONDON = "Europe/London";
// 2026-10-18 is still British Summer Time (+1); the clocks go back on the 25th.
const events = [
  event("Late sync", "2026-10-17T23:30:00Z", "2026-10-18T00:00:00Z"),
  event("Offsite", "2026-10-18", "2026-10-20", { isAllDay: true }),
  event("Standup", "2026-10-18T08:30:00Z", "2026-10-18T08:45:00Z", { conferenceUrl: "https://meet.google.com/abc-defg", htmlLink: "https://calendar.google.com/e/1", location: "Room 4" }),
  event("Planning", "2026-10-18T13:00:00Z", "2026-10-18T14:00:00Z", { location: "Room 4" }),
  event("Retro", "2026-10-19T13:00:00Z", "2026-10-19T14:00:00Z"),
];
const ok = { state: "ok" as const, events };

describe("eventsOnDay", () => {
  it("puts an event on the London day it starts, so 23:30Z on the 17th is 00:30 on the 18th", () => {
    expect(eventsOnDay(events, "2026-10-18", LONDON).map((item) => item.title)).toEqual(["Offsite", "Late sync", "Standup", "Planning"]);
    expect(eventsOnDay(events, "2026-10-17", LONDON)).toEqual([]);
  });
  it("lists an all-day event on every day it covers except its exclusive end", () => {
    expect(eventsOnDay(events, "2026-10-19", LONDON).map((item) => item.title)).toEqual(["Offsite", "Retro"]);
    expect(eventsOnDay(events, "2026-10-20", LONDON).map((item) => item.title)).toEqual([]);
  });
  it("follows the zone: the same events land on different days in Tokyo (Planning is 22:00 on the 18th there, so not the 19th)", () => {
    expect(eventsOnDay(events, "2026-10-19", "Asia/Tokyo").map((item) => item.title)).toEqual(["Offsite", "Retro"]);
  });
});

describe("nextEvent and describeWait", () => {
  it("is the one running now, else the soonest to start, and never an all-day event", () => {
    expect(nextEvent(events, Date.parse("2026-10-18T08:35:00Z"))?.title).toBe("Standup");
    expect(nextEvent(events, Date.parse("2026-10-18T09:00:00Z"))?.title).toBe("Planning");
    expect(nextEvent([events[1]], Date.parse("2026-10-18T09:00:00Z"))).toBeUndefined();
  });
  it.each([[30_000, "1 min"], [25 * 60_000, "25 min"], [90 * 60_000, "1h 30m"], [125 * 60_000, "2h 05m"], [26 * 3_600_000, "1d 2h"]])("%i ms → %s", (ms, label) => expect(describeWait(ms)).toBe(label));
});

describe("formatCalendarDay", () => {
  const now = Date.parse("2026-10-18T07:00:00Z");
  it("shows London times, join links and the zone, with one primary action", () => {
    const message = formatCalendarDay({ data: ok, day: "2026-10-18", channel: "C", now, zone: LONDON });
    const body = JSON.stringify(message.blocks);
    expect(message.text).toContain("Calendar · Today · Sun 18 Oct");
    expect(message.text).toContain("09:30–09:45 Standup");
    expect(message.text).toContain("14:00–15:00 Planning");
    expect(message.text).toContain("All day Offsite");
    expect(body).toContain("<https://meet.google.com/abc-defg|Join>");
    expect(body).toContain("Room 4");
    expect(body).toContain("Times in Europe/London.");
    const buttons = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []);
    expect(buttons).toHaveLength(1);
  });
  it("doesn't print the room when there's a join link, and caps a long day", () => {
    const body = JSON.stringify(formatCalendarDay({ data: ok, day: "2026-10-18", channel: "C", now, zone: LONDON }).blocks);
    expect(body.match(/Room 4/g)).toHaveLength(1);
    const busy = { state: "ok" as const, events: Array.from({ length: 12 }, (_, i) => event(`Meeting ${i}`, `2026-10-18T${String(8 + i).padStart(2, "0")}:00:00Z`, `2026-10-18T${String(8 + i).padStart(2, "0")}:30:00Z`)) };
    const message = formatCalendarDay({ data: busy, day: "2026-10-18", channel: "C", now, zone: LONDON });
    expect(message.blocks!.length).toBeLessThanOrEqual(50);
    expect(message.text).toContain("+4 more in DevHub");
  });
  it("says there are no meetings, and explains an unconnected or expired calendar", () => {
    expect(formatCalendarDay({ data: ok, day: "2026-10-22", channel: "C", now, zone: LONDON }).text).toContain("No meetings.");
    expect(formatCalendarDay({ data: { state: "not-configured" }, day: "2026-10-18", channel: "C" }).text).toContain("isn't connected");
    expect(formatCalendarDay({ data: { state: "needs-reauth" }, day: "2026-10-18", channel: "C" }).text).toContain("needs reconnecting");
  });
  it("escapes titles", () => {
    const hostile = { state: "ok" as const, events: [event("<!channel> & <@UOTHER>", "2026-10-18T09:00:00Z", "2026-10-18T10:00:00Z")] };
    const body = JSON.stringify(formatCalendarDay({ data: hostile, day: "2026-10-18", channel: "C", now, zone: LONDON }).blocks);
    expect(body).not.toContain("<!channel>");
    expect(body).toContain("&lt;!channel&gt;");
  });
});

describe("formatNextMeeting", () => {
  it("shows the time left and Join as the only button", () => {
    const message = formatNextMeeting({ data: ok, channel: "C", now: Date.parse("2026-10-18T07:00:00Z"), zone: LONDON });
    expect(message.text).toContain("Standup 09:30–09:45 · in 1h 30m");
    const buttons = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []) as Array<{ text: { text: string }; url?: string }>;
    expect(buttons.map((button) => [button.text.text, button.url])).toEqual([["Join", "https://meet.google.com/abc-defg"]]);
  });
  it("says Now and when it ends for a meeting in progress; opens the calendar when there is no link", () => {
    expect(formatNextMeeting({ data: ok, channel: "C", now: Date.parse("2026-10-18T08:40:00Z"), zone: LONDON }).text).toContain("Now · ends in 5 min");
    const message = formatNextMeeting({ data: ok, channel: "C", now: Date.parse("2026-10-18T09:00:00Z"), zone: LONDON });
    const buttons = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []) as Array<{ text: { text: string } }>;
    expect(message.text).toContain("Planning");
    expect(buttons.map((button) => button.text.text)).toEqual(["Open in DevHub"]);
  });
  it("won't offer a link that isn't http(s) or carries credentials", () => {
    const sneaky = { state: "ok" as const, events: [event("Call", "2026-10-18T09:00:00Z", "2026-10-18T10:00:00Z", { conferenceUrl: "javascript:alert(1)" }), event("Call 2", "2026-10-18T11:00:00Z", "2026-10-18T12:00:00Z", { conferenceUrl: "https://u:p@meet.example/x" })] };
    for (const now of ["2026-10-18T08:00:00Z", "2026-10-18T10:30:00Z"]) {
      expect(JSON.stringify(formatNextMeeting({ data: sneaky, channel: "C", now: Date.parse(now), zone: LONDON }).blocks)).not.toMatch(/javascript:|u:p@/);
    }
  });
  it("says when nothing is left, or the calendar isn't connected", () => {
    expect(formatNextMeeting({ data: ok, channel: "C", now: Date.parse("2026-11-01T00:00:00Z"), zone: LONDON }).text).toContain("No more meetings");
    expect(formatNextMeeting({ data: { state: "not-configured" }, channel: "C" }).text).toContain("isn't connected");
  });
});

describe("slackTimeZone", () => {
  it("honours DEVHUB_TIMEZONE, ignores a bad one, and otherwise follows the machine", () => {
    expect(slackTimeZone({ DEVHUB_TIMEZONE: "Europe/Paris" })).toBe("Europe/Paris");
    expect(slackTimeZone({ DEVHUB_TIMEZONE: "Not/AZone" })).toBe("Europe/London");
    expect(slackTimeZone({})).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London");
  });
});
