import { buildStandupQuery, type StandupParams } from "@shared/standup/params";
export { buildStandupQuery } from "@shared/standup/params";
export type { StandupParams } from "@shared/standup/params";

/**
 * Shared client-side helpers for building the standup endpoint query string.
 *
 * Previously each caller (clipboard copy, daily-note save, preview) constructed
 * its own URLSearchParams — small enough to drift quickly when we add a new
 * filter (like `excludeRepos`).
 */

export const STANDUP_STORAGE_KEYS = {
  startTime: "standup-start-time",
  endTime: "standup-end-time",
  excludedRepos: "standup-excluded-repos",
} as const;

/** Read the persisted excluded-repos list from localStorage. Safe in SSR. */
export function readExcludedRepos(): string[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STANDUP_STORAGE_KEYS.excludedRepos);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function writeExcludedRepos(names: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STANDUP_STORAGE_KEYS.excludedRepos, JSON.stringify(names));
}

/** Shape returned by `/api/standup/markdown`. */
export interface StandupResponse {
  markdown: string;
  meta?: {
    reposScanned: number;
    reposExcluded: number;
    repoFailures: string[];
    reposScannedNames?: string[];
    /** Repos where `gh pr list` failed — means PRs from these repos may be missing. */
    prScanFailedRepos?: string[];
  };
}

/** One-shot fetch of the standup markdown for the given params. */
export async function fetchStandup(
  params: StandupParams = {},
): Promise<{ ok: true; data: StandupResponse } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/standup/markdown${buildStandupQuery(params)}`);
    const body = (await res.json().catch(() => ({}))) as Partial<StandupResponse> & { error?: string };
    if (!res.ok) {
      return { ok: false, message: body.error ?? `Request failed (${res.status})` };
    }
    if (typeof body.markdown !== "string") {
      return { ok: false, message: "Invalid standup response" };
    }
    return { ok: true, data: { markdown: body.markdown, meta: body.meta } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Network error" };
  }
}
