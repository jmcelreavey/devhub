import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dedupeCalendarEvents,
  resolveActiveCalendarIds,
  type CalendarEvent,
  type GoogleCalendarInfo,
} from "./google-calendar";

let tmpRepo = "";
let originalRepoRoot: string | undefined;

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cal-resolve-"));
  originalRepoRoot = process.env.REPO_ROOT;
  process.env.REPO_ROOT = tmpRepo;
});

afterEach(() => {
  if (originalRepoRoot === undefined) delete process.env.REPO_ROOT;
  else process.env.REPO_ROOT = originalRepoRoot;
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

const calendars: GoogleCalendarInfo[] = [
  { id: "primary", summary: "Work", primary: true, selected: true },
  { id: "personal@group.calendar.google.com", summary: "Personal", selected: true },
  { id: "holidays@group.calendar.google.com", summary: "Holidays", selected: false },
];

describe("resolveActiveCalendarIds", () => {
  it("uses Google-selected calendars when no local selection is saved", () => {
    expect(resolveActiveCalendarIds(calendars)).toEqual([
      "primary",
      "personal@group.calendar.google.com",
    ]);
  });

  it("falls back to primary when nothing is selected", () => {
    const noneSelected = calendars.map((c) => ({ ...c, selected: false }));
    expect(resolveActiveCalendarIds(noneSelected)).toEqual(["primary"]);
  });
});

describe("dedupeCalendarEvents", () => {
  it("removes duplicates by iCalUID", () => {
    const events: CalendarEvent[] = [
      {
        id: "primary::1",
        title: "Standup",
        start: "2026-06-05T09:00:00Z",
        end: "2026-06-05T09:30:00Z",
        isAllDay: false,
        iCalUID: "uid-1",
      },
      {
        id: "personal::9",
        title: "Standup",
        start: "2026-06-05T09:00:00Z",
        end: "2026-06-05T09:30:00Z",
        isAllDay: false,
        iCalUID: "uid-1",
      },
    ];
    expect(dedupeCalendarEvents(events)).toHaveLength(1);
  });

  it("keeps distinct events without a shared iCalUID", () => {
    const events: CalendarEvent[] = [
      {
        id: "primary::1",
        title: "A",
        start: "2026-06-05T09:00:00Z",
        end: "2026-06-05T10:00:00Z",
        isAllDay: false,
      },
      {
        id: "primary::2",
        title: "B",
        start: "2026-06-05T11:00:00Z",
        end: "2026-06-05T12:00:00Z",
        isAllDay: false,
      },
    ];
    expect(dedupeCalendarEvents(events)).toHaveLength(2);
  });
});
