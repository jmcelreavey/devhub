import { describe, it, expect } from "vitest";
import { buildMeetingNoteMarkdown, meetingNotePath } from "./meeting-note";
import type { CalendarEvent } from "./google-calendar";

const event: CalendarEvent = {
  id: "evt1",
  title: "Sprint Planning!",
  start: "2026-05-30T14:00:00+01:00",
  end: "2026-05-30T15:00:00+01:00",
  isAllDay: false,
  conferenceUrl: "https://meet.example/abc",
  htmlLink: "https://calendar.google.com/event?eid=xyz",
  attendees: ["a@x.com", "b@x.com"],
};

describe("meetingNotePath", () => {
  it("builds a dated, slugified path under meetings/", () => {
    expect(meetingNotePath(event)).toBe("meetings/2026-05-30-sprint-planning");
  });

  it("falls back to 'meeting' for an empty title", () => {
    expect(meetingNotePath({ ...event, title: "" })).toBe("meetings/2026-05-30-meeting");
  });
});

describe("buildMeetingNoteMarkdown", () => {
  it("pre-fills header fields and includes scaffold sections", () => {
    const md = buildMeetingNoteMarkdown(event);
    expect(md).toContain("# Sprint Planning!");
    expect(md).toContain("**Date:** 2026-05-30");
    expect(md).toContain("**Time:** 14:00–15:00");
    expect(md).toContain("**Attendees:** a@x.com, b@x.com");
    expect(md).toContain("**Join:** https://meet.example/abc");
    expect(md).toContain("[Open in Calendar](https://calendar.google.com/event?eid=xyz)");
    expect(md).toContain("## Agenda");
    expect(md).toContain("## Action items");
    expect(md).toContain("- [ ] ");
  });

  it("omits optional lines and labels all-day events", () => {
    const md = buildMeetingNoteMarkdown({ ...event, isAllDay: true, conferenceUrl: undefined, htmlLink: undefined, location: undefined });
    expect(md).toContain("**Time:** All day");
    expect(md).not.toContain("**Join:**");
    expect(md).not.toContain("Open in Calendar");
    expect(md).not.toContain("**Location:**");
  });
});
