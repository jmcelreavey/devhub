/**
 * Meeting-note path + markdown scaffold — shared by the Today strip button
 * and the DevHub MCP `notes_create_meeting` tool.
 */

export interface MeetingNoteEvent {
  title: string;
  /** ISO datetime or YYYY-MM-DD (all-day). */
  start: string;
  end: string;
  isAllDay?: boolean;
  location?: string;
  conferenceUrl?: string;
  htmlLink?: string;
  attendees?: string[];
}

export interface SlugifyOptions {
  maxLen?: number;
  fallback?: string;
}

export function slugify(text: string, options: SlugifyOptions = {}): string {
  const { maxLen = 48, fallback = "untitled" } = options;
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLen) || fallback;
}

/** Repo-relative note path (no extension) for a meeting note derived from an event. */
export function meetingNotePath(event: MeetingNoteEvent): string {
  const date = (event.start || "").slice(0, 10) || "undated";
  return `meetings/${date}-${slugify(event.title, { maxLen: 60, fallback: "meeting" })}`;
}

function dateLabel(event: MeetingNoteEvent): string {
  return (event.start || "").slice(0, 10);
}

function timeLabel(event: MeetingNoteEvent): string {
  if (event.isAllDay) return "All day";
  const start = event.start.slice(11, 16);
  const end = event.end.slice(11, 16);
  return end ? `${start}–${end}` : start;
}

/** Markdown scaffold for a meeting note, pre-filled from a calendar event. */
export function buildMeetingNoteMarkdown(event: MeetingNoteEvent): string {
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
