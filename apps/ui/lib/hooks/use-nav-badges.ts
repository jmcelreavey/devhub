"use client";

import { useSidebarCounts, type SidebarCounts } from "@/lib/hooks/use-sidebar-counts";
import { READ_STATUS_KEYS, useIsUnseen } from "@/lib/activity/read-status";
import { useLive } from "@/lib/hooks/use-fetch";
import { useNotifications } from "@/lib/notifications/use-notifications";
import type { CalendarEvent } from "@shared/calendar/types";

export interface NavUnseen {
  tickets: boolean;
  prs: boolean;
}

export interface NavBadges {
  counts: SidebarCounts | undefined;
  unseen: NavUnseen;
  /** Meetings still ahead of you today — 0 once the day is clear. */
  calendarRemaining: number;
  notificationsUnread: number;
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
 * today's remaining meetings; Notifications shows unread updates.
 */
export function useNavBadges(): NavBadges {
  const counts = useSidebarCounts();
  const notifications = useNotifications();
  const tickets = useIsUnseen(
    READ_STATUS_KEYS.dashboardTickets,
    counts?.signatures.tickets ?? "",
  );
  const prs = useIsUnseen(
    READ_STATUS_KEYS.dashboardPrs,
    counts?.signatures.prs ?? "",
  );
  // Shares the SWR cache with Calendar — no extra polling cost.
  const { data: cal } = useLive<CalendarResponse>("/api/calendar", { /* Google Calendar changes independently. */ refreshInterval: 60_000 });
  const calendarRemaining = cal && !cal.error ? countRemainingMeetings(cal.events ?? []) : 0;
  return { counts, unseen: { tickets, prs: prs && (counts?.actionablePrs ?? 0) > 0 }, calendarRemaining, notificationsUnread: notifications.data?.unread ?? 0 };
}

/** Queue-depth badge for a nav item (0 = no badge). */
export function countForItem(
  icon: string,
  counts: SidebarCounts | undefined,
  extras?: { calendarRemaining?: number; notificationsUnread?: number },
): number {
  if (icon === "calendar") return extras?.calendarRemaining ?? 0;
  if (icon === "bell") return extras?.notificationsUnread ?? 0;
  if (!counts) return 0;
  if (icon === "tickets") return counts.tickets;
  if (icon === "prs") return counts.actionablePrs ?? 0;
  if (icon === "shared") return counts.shared;
  return 0;
}

/** Whether a nav item has new activity unseen since its last visit. */
export function unseenForItem(icon: string, unseen: NavUnseen): boolean {
  // Jira tickets live on the Tasks page's Jira tab — there is no Tickets row any more.
  if (icon === "tasks") return unseen.tickets;
  if (icon === "prs") return unseen.prs;
  return false;
}
