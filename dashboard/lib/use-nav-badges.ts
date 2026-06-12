"use client";

import { useSidebarCounts, type SidebarCounts } from "@/lib/use-sidebar-counts";
import { READ_STATUS_KEYS, useIsUnseen } from "@/lib/read-status";
import { useLive } from "@/lib/use-fetch";
import type { CalendarEvent } from "@/lib/google-calendar";

export interface NavUnseen {
  tickets: boolean;
  prs: boolean;
}

export interface NavBadges {
  counts: SidebarCounts | undefined;
  unseen: NavUnseen;
  /** Meetings still ahead of you today — 0 once the day is clear. */
  calendarRemaining: number;
}

interface CalendarResponse {
  events?: CalendarEvent[];
  error?: string;
}

function countRemainingMeetings(events: CalendarEvent[]): number {
  const now = Date.now();
  return events.filter((e) => !e.isAllDay && new Date(e.end).getTime() > now).length;
}

/**
 * Single source of truth for nav queue-depth counts and "unseen since
 * last visit" dots. Used by both the desktop sidebar and the mobile
 * burger nav so the two never drift apart.
 *
 * Counts appear only where action is owed (2026-06 IA): Calendar shows
 * today's remaining meetings, Work shows open tasks.
 */
export function useNavBadges(): NavBadges {
  const counts = useSidebarCounts();
  const tickets = useIsUnseen(
    READ_STATUS_KEYS.dashboardTickets,
    counts?.signatures.tickets ?? "",
  );
  const prs = useIsUnseen(
    READ_STATUS_KEYS.dashboardPrs,
    counts?.signatures.prs ?? "",
  );
  // Shares the SWR cache with CalendarWidget — no extra polling cost.
  const { data: cal } = useLive<CalendarResponse>("/api/calendar");
  const calendarRemaining = cal && !cal.error ? countRemainingMeetings(cal.events ?? []) : 0;
  return { counts, unseen: { tickets, prs }, calendarRemaining };
}

/** Queue-depth badge for a nav item (0 = no badge). */
export function countForItem(
  icon: string,
  counts: SidebarCounts | undefined,
  extras?: { calendarRemaining?: number },
): number {
  if (icon === "calendar") return extras?.calendarRemaining ?? 0;
  if (!counts) return 0;
  if (icon === "tasks") return counts.tasks;
  if (icon === "tickets") return counts.tickets;
  if (icon === "prs") return counts.prs;
  if (icon === "shared") return counts.shared;
  return 0;
}

/** Whether a nav item has new activity unseen since its last visit. */
export function unseenForItem(icon: string, unseen: NavUnseen): boolean {
  if (icon === "tickets") return unseen.tickets;
  if (icon === "prs") return unseen.prs;
  return false;
}
