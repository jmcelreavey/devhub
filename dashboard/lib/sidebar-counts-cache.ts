/**
 * In-process TTL cache for GET /api/sidebar/counts.
 * Invalidate after anything that changes task/ticket/PR counts or signatures.
 */

export interface SidebarCounts {
  tasks: number;
  tickets: number;
  prs: number;
  /** Live links whose source has drifted (Live → Stale). */
  shared: number;
  signatures: {
    tickets: string;
    prs: string;
  };
}

let cache: { data: SidebarCounts; ts: number } | null = null;

export const SIDEBAR_COUNTS_TTL_MS = 60_000;

export function getSidebarCountsCache(): { data: SidebarCounts; ts: number } | null {
  return cache;
}

export function setSidebarCountsCache(data: SidebarCounts): void {
  cache = { data, ts: Date.now() };
}

export function invalidateSidebarCountsCache(): void {
  cache = null;
}
