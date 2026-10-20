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
  actionablePrs?: number | null;
  needsYou?: number | null;
  reviewRequested?: number | null;
  blockedWork?: number | null;
  profile?: string;
  updatedAt?: string;
  unavailable?: string[];
  signatures: {
    tickets: string;
    prs: string;
  };
}

const cache = new Map<string, { data: SidebarCounts; ts: number }>();

export const SIDEBAR_COUNTS_TTL_MS = 60_000;

export function getSidebarCountsCache(profile = "legacy"): { data: SidebarCounts; ts: number } | null {
  return cache.get(profile) ?? null;
}

export function setSidebarCountsCache(data: SidebarCounts, profile = "legacy"): void {
  cache.set(profile, { data, ts: Date.now() });
}

export function invalidateSidebarCountsCache(): void {
  cache.clear();
}

export function expireSidebarCountsCache(profile: string): void {
  const previous = cache.get(profile);
  if (previous) cache.set(profile, { ...previous, ts: 0 });
}
