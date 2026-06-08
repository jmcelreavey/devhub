"use client";

import { useSidebarCounts, type SidebarCounts } from "@/lib/use-sidebar-counts";
import { READ_STATUS_KEYS, useIsUnseen } from "@/lib/read-status";

export interface NavUnseen {
  tickets: boolean;
  prs: boolean;
}

export interface NavBadges {
  counts: SidebarCounts | undefined;
  unseen: NavUnseen;
}

/**
 * Single source of truth for nav queue-depth counts and "unseen since
 * last visit" dots. Used by both the desktop sidebar and the mobile
 * burger nav so the two never drift apart.
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
  return { counts, unseen: { tickets, prs } };
}

/** Queue-depth badge for a nav item (0 = no badge). */
export function countForItem(icon: string, counts: SidebarCounts | undefined): number {
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
