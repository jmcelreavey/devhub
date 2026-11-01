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

