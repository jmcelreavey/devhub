/**
 * Meeting-note path + markdown scaffold — shared by the Today strip button
 * and the DevHub MCP `notes_create_meeting` tool.
 *
 * Same EntityRef / ## Links contract as task-note so calendar cards and
 * task rows share one backlink shape.
 */

import {
  buildEntityLinksSection,
  joinMarkdownLines,
  slugify,
  type EntityRef,
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
  /** Calendar event id when known (for future hop-around). */
  id?: string;
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

/** EntityRefs embedded in a meeting note's ## Links section. */
export function meetingEntityRefs(event: MeetingNoteEvent): Array<EntityRef | string> {
  const refs: Array<EntityRef | string> = [];
  if (event.htmlLink) {
    refs.push({
      kind: "calendar",
      id: event.id || event.htmlLink,
      label: "Open in Calendar",
      href: event.htmlLink,
    });
  }
  if (event.conferenceUrl) {
    refs.push(`**Join:** ${event.conferenceUrl}`);
  }
  return refs;
}

/** Markdown scaffold for a meeting note, pre-filled from a calendar event. */
export function buildMeetingNoteMarkdown(event: MeetingNoteEvent): string {
  const links = buildEntityLinksSection(meetingEntityRefs(event));

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
