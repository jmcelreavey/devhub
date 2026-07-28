"use client";

import type { CalendarEvent } from "@/lib/google-calendar";
import { buildMeetingNoteMarkdown, meetingNotePath } from "@/lib/meeting-note";
import { EntityNoteAction } from "@/components/EntityNoteAction";

interface CreateMeetingNoteButtonProps {
  event: CalendarEvent;
  /** Icon-only compact variant for dense lists. */
  compact?: boolean;
}

/**
 * Calendar card affordance for the shared entity→note link.
 * Thin wrapper: path + scaffold come from meeting-note; open-or-create
 * is EntityNoteAction (same as task rows).
 */
export function CreateMeetingNoteButton({ event, compact = false }: CreateMeetingNoteButtonProps) {
  return (
    <EntityNoteAction
      path={meetingNotePath(event)}
      markdown={buildMeetingNoteMarkdown(event)}
      entityLabel={event.title}
      variant={compact ? "icon" : "button"}
      errorMessage="Couldn't create meeting note."
    />
  );
}
