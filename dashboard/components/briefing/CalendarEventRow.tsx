"use client";

import { useRouter } from "next/navigation";
import { Calendar, Copy, FileText, Video } from "lucide-react";
import type { CalendarEvent } from "@/lib/google-calendar";
import { formatTime } from "@/lib/utils";
import { copyTextAndToast } from "@/lib/pr-slack";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { buildMeetingNoteMarkdown, meetingNotePath } from "@/lib/meeting-note";
import { openInBrowser } from "@/lib/desktop/bridge";
import { PersonChip } from "@/components/PersonChip";
import { EntityLinkChips } from "@/components/EntityLinkChips";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { useToast } from "@/lib/hooks/use-toast";

function isHappeningNow(start: string, end: string): boolean {
  const now = Date.now();
  return now >= new Date(start).getTime() && now <= new Date(end).getTime();
}

function isImminent(iso: string): boolean {
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 && ms <= 10 * 60_000;
}

export function eventJoinIsUrgent(event: CalendarEvent): boolean {
  if (!event.conferenceUrl || event.isAllDay) return false;
  return isHappeningNow(event.start, event.end) || isImminent(event.start);
}

function copyEventText(event: CalendarEvent): string {
  const when = event.isAllDay
    ? "All day"
    : `${formatTime(event.start)}–${formatTime(event.end)}`;
  const lines = [event.title, when];
  if (event.location) lines.push(event.location);
  if (event.conferenceUrl) lines.push(`Meet: ${event.conferenceUrl}`);
  if (event.htmlLink) lines.push(event.htmlLink);
  return lines.join("\n");
}

export function CalendarEventRow({
  event,
  density = "compact",
  showChips = false,
  showCalendarName = false,
}: {
  event: CalendarEvent;
  density?: "compact" | "comfortable";
  showChips?: boolean;
  showCalendarName?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const menu = useContextMenu<CalendarEvent>();
  const notePath = meetingNotePath(event);
  const noteExists = useVaultNoteExists(notePath);
  const compact = density === "compact";
  const urgentJoin = eventJoinIsUrgent(event);

  const openNote = async () => {
    try {
      const result = await createOrOpenVaultNote({
        path: notePath,
        markdown: buildMeetingNoteMarkdown(event),
      });
      router.push(result.href);
    } catch {
      toast.error("Couldn't create meeting note.");
    }
  };

  const groups: ContextMenuGroup[] = [
    {
      id: "event",
      items: [
        {
          id: "note",
          label: noteExists ? "Open note" : "Create note",
          icon: <FileText size={12} />,
          onSelect: () => void openNote(),
        },
        ...(event.conferenceUrl
          ? [
              {
                id: "meet",
                label: "Open Meet",
                icon: <Video size={12} />,
                onSelect: () => void openInBrowser(event.conferenceUrl!),
              },
            ]
          : []),
        ...(event.htmlLink
          ? [
              {
                id: "gcal",
                label: "Open in Google Calendar",
                icon: <Calendar size={12} />,
                onSelect: () => void openInBrowser(event.htmlLink!),
              },
            ]
          : []),
        {
          id: "copy",
          label: "Copy event",
          icon: <Copy size={12} />,
          onSelect: () => void copyTextAndToast(copyEventText(event), "event", toast),
        },
      ],
    },
  ];

  return (
    <div className="min-w-0">
      <div
        className={`group flex min-w-0 items-start gap-2 rounded ${compact ? "py-0.5" : "py-2"} transition-colors hover:bg-[var(--bg-muted)]`}
        {...menu.bindRow(event)}
      >
        <span
          className="shrink-0 font-mono text-xs text-text-subtle"
          style={{ minWidth: compact ? 44 : 50 }}
        >
          {event.isAllDay ? (
            "All day"
          ) : compact ? (
            formatTime(event.start)
          ) : (
            <>
              {formatTime(event.start)}
              <br />
              <span className="text-text-subtle">{formatTime(event.end)}</span>
            </>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={`min-w-0 break-words leading-snug ${compact ? "truncate text-xs" : "font-medium text-sm"}`}
            style={{
              color: isHappeningNow(event.start, event.end) ? "var(--accent)" : "var(--text)",
            }}
          >
            {event.title}
          </div>
          {event.organizer?.displayName || event.organizer?.email ? (
            <PersonChip
              name={event.organizer.displayName || event.organizer.email || ""}
              email={event.organizer.email}
              size={compact ? 14 : 16}
              className={compact ? "mt-0.5 hidden max-w-[8rem] sm:inline-flex" : "mt-0.5 max-w-[14rem]"}
            />
          ) : null}
          {showCalendarName && event.calendarName ? (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-text-subtle">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-[var(--radius-sm)]"
                style={{ background: event.calendarColor ?? "var(--accent)" }}
                aria-hidden
              />
              {event.calendarName}
            </div>
          ) : null}
          {!compact && event.location ? (
            <div className="mt-0.5 text-xs text-text-subtle">{event.location}</div>
          ) : null}
        </div>
        {urgentJoin && event.conferenceUrl ? (
          <a
            href={event.conferenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="urgency-pulse inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Video size={11} aria-hidden /> Join
          </a>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {noteExists ? (
            <span className="row-note-glyph" title="Note exists" aria-hidden>
              <FileText size={12} />
            </span>
          ) : null}
          <RowMenuKebab
            label={`Actions for ${event.title}`}
            onOpen={(x, y) => menu.openAtPoint(x, y, event)}
          />
        </div>
      </div>
      {showChips ? (
        <EntityLinkChips
          kind="calendar"
          id={event.id}
          date={(event.start || "").slice(0, 10)}
          label={event.title}
          meetingTitle={event.title}
          href={event.htmlLink}
          className={compact ? "ml-[52px]" : undefined}
        />
      ) : null}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${event.title} actions`}
      />
    </div>
  );
}
