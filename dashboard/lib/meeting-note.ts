import type { CalendarEvent } from "./google-calendar";
import { slugify } from "./slugify";

/** Repo-relative note path (no extension) for a meeting note derived from an event. */
export function meetingNotePath(event: CalendarEvent): string {
  const date = (event.start || "").slice(0, 10) || "undated";
  return `meetings/${date}-${slugify(event.title, { maxLen: 60, fallback: "meeting" })}`;
}

function dateLabel(event: CalendarEvent): string {
  return (event.start || "").slice(0, 10);
}

function timeLabel(event: CalendarEvent): string {
  if (event.isAllDay) return "All day";
  const start = event.start.slice(11, 16);
  const end = event.end.slice(11, 16);
  return end ? `${start}–${end}` : start;
}

/** Markdown scaffold for a meeting note, pre-filled from a calendar event. */
export function buildMeetingNoteMarkdown(event: CalendarEvent): string {
  const lines: (string | null)[] = [
    `# ${event.title}`,
    "",
    `**Date:** ${dateLabel(event)}`,
    `**Time:** ${timeLabel(event)}`,
    `**Attendees:** ${event.attendees?.join(", ") ?? ""}`,
    event.location ? `**Location:** ${event.location}` : null,
    event.conferenceUrl ? `**Join:** ${event.conferenceUrl}` : null,
    event.htmlLink ? `**Event:** [Open in Calendar](${event.htmlLink})` : null,
    "",
    "## Agenda",
    "",
    "- ",
    "",
    "## Notes",
    "",
    "- ",
    "",
    "## Action items",
    "",
    "- [ ] ",
  ];
  return lines.filter((l) => l !== null).join("\n");
}
