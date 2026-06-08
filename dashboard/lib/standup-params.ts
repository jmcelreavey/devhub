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

export interface StandupParams {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  /** Repo directory names to leave out of the git commits scan. */
  excludeRepos?: string[];
}

/** `?startDate=...&excludeRepos=foo,bar` — or empty string when no params set. */
export function buildStandupQuery(params: StandupParams = {}): string {
  const qs = new URLSearchParams();
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  if (params.startTime) qs.set("startTime", params.startTime);
  if (params.endTime) qs.set("endTime", params.endTime);
  if (params.excludeRepos && params.excludeRepos.length > 0) {
    qs.set("excludeRepos", params.excludeRepos.join(","));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

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
