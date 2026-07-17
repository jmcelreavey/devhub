import { useLive } from "@/lib/use-fetch";
import type { SidebarCounts } from "@/lib/sidebar-counts-cache";
import { READ_STATUS_KEYS, useMarkSeenOnVisit } from "@/lib/read-status";

export type { SidebarCounts };

export function useSidebarCounts(): SidebarCounts | undefined {
  const { data } = useLive<SidebarCounts>("/api/sidebar/counts", {
    refreshInterval: 60_000,
  });
  return data;
}

export function useMarkTicketsSeen(): void {
  const counts = useSidebarCounts();
  useMarkSeenOnVisit(READ_STATUS_KEYS.dashboardTickets, counts?.signatures.tickets ?? "");
}

export function useMarkPrsSeen(): void {
  const counts = useSidebarCounts();
  useMarkSeenOnVisit(READ_STATUS_KEYS.dashboardPrs, counts?.signatures.prs ?? "");
}
