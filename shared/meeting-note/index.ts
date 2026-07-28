/**
 * Meeting-note path + markdown scaffold — shared by the Today strip button
 * and the DevHub MCP `notes_create_meeting` tool.
 */

import {
  buildEntityLinksSection,
  joinMarkdownLines,
  slugify,
} from "../entity-note/index.ts";

export type { SlugifyOptions } from "../entity-note/index.ts";
export { slugify } from "../entity-note/index.ts";

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
  const links = buildEntityLinksSection([
    event.htmlLink ? `**Event:** [Open in Calendar](${event.htmlLink})` : null,
    event.conferenceUrl ? `**Join:** ${event.conferenceUrl}` : null,
  ]);

  return joinMarkdownLines([
    `# ${event.title}`,
    "",
    `**Date:** ${dateLabel(event)}`,
    `**Time:** ${timeLabel(event)}`,
    `**Attendees:** ${event.attendees?.join(", ") ?? ""}`,
    event.location ? `**Location:** ${event.location}` : null,
    "",
    links ? links.trimEnd() : null,
    links ? "" : null,
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
  ]);
}
