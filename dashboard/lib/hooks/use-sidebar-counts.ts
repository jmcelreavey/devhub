import { useLive } from "@/lib/hooks/use-fetch";
import type { SidebarCounts } from "@/lib/sidebar-counts-cache";
import { READ_STATUS_KEYS, useMarkSeenOnVisit } from "@/lib/read-status";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { profileKey } from "@/lib/tasks/profile-scope";

export type { SidebarCounts };

export function useSidebarCounts(): SidebarCounts | undefined {
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  const profileId = profile.data ? profile.data.active ?? "legacy" : undefined;
  const { data } = useLive<SidebarCounts>(profileKey("/api/sidebar/counts", profileId), {
    refreshInterval: 60_000,
    keepPreviousData: false,
  });
  return !profile.error && data?.profile === profileId ? data : undefined;
}

export function useMarkTicketsSeen(): void {
  const counts = useSidebarCounts();
  useMarkSeenOnVisit(READ_STATUS_KEYS.dashboardTickets, counts?.signatures.tickets ?? "");
}

export function useMarkPrsSeen(): void {
  const counts = useSidebarCounts();
  useMarkSeenOnVisit(READ_STATUS_KEYS.dashboardPrs, counts?.signatures.prs ?? "");
}
