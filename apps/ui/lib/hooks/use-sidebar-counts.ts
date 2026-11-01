import { useLive } from "@/lib/hooks/use-fetch";
import type { SidebarCounts } from "../../../core/src/lib/activity/sidebar-counts-cache";
import { READ_STATUS_KEYS, useMarkSeenOnVisit } from "@/lib/activity/read-status";
import { profileKey } from "@shared/tasks/profile-scope";
import { useNotificationProfile } from "@/lib/notifications/use-notifications";

export type { SidebarCounts };

export function useSidebarCounts(): SidebarCounts | undefined {
  const { profile } = useNotificationProfile();
  const { data } = useLive<SidebarCounts>(profileKey("/api/sidebar/counts?scope=local", profile), { keepPreviousData: false });
  useLive<{ ok: boolean }>(profileKey("/api/sidebar/counts?scope=external", profile), { /* Remote counts change independently. */ refreshInterval: 60_000 });
  return profile && data?.profile === profile ? data : undefined;
}

export function useMarkTicketsSeen(): void {
  const counts = useSidebarCounts();
  useMarkSeenOnVisit(READ_STATUS_KEYS.dashboardTickets, counts?.signatures.tickets ?? "");
}

export function useMarkPrsSeen(): void {
  const counts = useSidebarCounts();
  useMarkSeenOnVisit(READ_STATUS_KEYS.dashboardPrs, counts?.signatures.prs ?? "");
}
