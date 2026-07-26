/**
 * Build Datadog web UI URLs for the DevHub Datadog cockpit (Tier 1 deep links).
 * Optional env overrides (see /api/datadog/links) take precedence when set.
 */

export const DATADOG_MONITOR_QUERY_ONCALL = "notification:@oncall-dad";
export const DATADOG_MONITOR_QUERY_TEAM_ALERTS = "notification:@slack-dad-team-alerts";

/** Events Explorer / v2 search — monitor alert notifications (past 24h). Override via env if facets differ. */
export const DATADOG_EVENTS_QUERY_ALERTS_24H = "source:alert";
export const DATADOG_EVENTS_QUERY_ONCALL_24H = 'source:alert "@oncall-dad"';
export const DATADOG_EVENTS_QUERY_TEAM_ALERTS_24H = 'source:alert "@slack-dad-team-alerts"';

/** Maps DD_SITE values to the browser app origin (no trailing slash). */
/** REST API host for the Datadog site (no scheme). */
export function datadogApiHost(ddSite: string): string {
  const site = ddSite.trim().toLowerCase();
  if (!site || site === "datadoghq.com") return "api.datadoghq.com";
  if (site === "datadoghq.eu") return "api.datadoghq.eu";
  if (site === "ddog-gov.com") return "api.ddog-gov.com";
  if (site.endsWith(".datadoghq.com")) return `api.${site}`;
  return "api.datadoghq.com";
}

/** Normalised `https://host` base for Datadog REST calls (no trailing slash). */
export function datadogApiBaseUrl(apiHost: string): string {
  return `https://${apiHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

/** Auth headers every Datadog v2 API call needs (API key + application key). */
export function datadogAuthHeaders(apiKey: string, applicationKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": applicationKey,
  };
}

/**
 * Turn a Datadog error body into a readable string. v2 `errors` come back as
 * objects (`{ title, detail }`), not plain strings — naively joining them
 * yields "[object Object]". Falls back to the HTTP status line.
 */
export function datadogErrorMessage(body: unknown, fallback: string): string {
  const errors = (body as { errors?: unknown })?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return fallback;
  const parts = errors.map((e) => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const { title, detail } = e as { title?: unknown; detail?: unknown };
      const text = [title, detail].filter((s) => typeof s === "string").join(": ");
      return text || JSON.stringify(e);
    }
    return String(e);
  });
  return parts.join("; ") || fallback;
}

export function datadogAppOrigin(ddSite: string): string {
  const site = ddSite.trim().toLowerCase();
  if (!site || site === "datadoghq.com") return "https://app.datadoghq.com";
  if (site === "datadoghq.eu") return "https://app.datadoghq.eu";
  if (site === "ddog-gov.com") return "https://app.ddog-gov.com";
  if (site.endsWith(".datadoghq.com")) return `https://${site}`;
  return "https://app.datadoghq.com";
}

export function buildManageMonitorsUrl(appOrigin: string, searchQuery: string): string {
  const base = appOrigin.replace(/\/$/, "");
  return `${base}/monitors/manage?${new URLSearchParams({ q: searchQuery }).toString()}`;
}

/** Local calendar day start → now (inclusive), ms since epoch. */
export function localDayBoundsMs(now: Date = new Date()): { fromMs: number; toMs: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return { fromMs: start.getTime(), toMs: now.getTime() };
}

/**
 * Event stream for the current local day (Datadog UI; params match classic stream URLs).
 * If your org uses a different path, set DATADOG_LINK_EVENTS_TODAY in `.env.local`.
 */
export function buildEventStreamTodayUrl(appOrigin: string, fromMs: number, toMs: number): string {
  const base = appOrigin.replace(/\/$/, "");
  const q = new URLSearchParams({
    from_ts: String(fromMs),
    to_ts: String(toMs),
    live: "false",
  });
  return `${base}/event/stream?${q.toString()}`;
}

export interface DatadogResolvedLinks {
  appOrigin: string;
  oncallUrl: string;
  teamAlertsUrl: string;
  eventsTodayUrl: string;
}

export type DatadogLinksApiResponse =
  | { configured: false }
  | ({ configured: true; ddSite: string } & DatadogResolvedLinks);

export function resolveDatadogDeepLinks(options: {
  ddSite: string;
  appOriginOverride?: string;
  linkOncall?: string;
  linkTeamAlerts?: string;
  linkEventsToday?: string;
  now?: Date;
}): DatadogResolvedLinks {
  const appOrigin = (options.appOriginOverride ?? datadogAppOrigin(options.ddSite)).replace(/\/$/, "");
  const { fromMs, toMs } = localDayBoundsMs(options.now ?? new Date());

  return {
    appOrigin,
    oncallUrl:
      options.linkOncall?.trim() ||
      buildManageMonitorsUrl(appOrigin, DATADOG_MONITOR_QUERY_ONCALL),
    teamAlertsUrl:
      options.linkTeamAlerts?.trim() ||
      buildManageMonitorsUrl(appOrigin, DATADOG_MONITOR_QUERY_TEAM_ALERTS),
    eventsTodayUrl:
      options.linkEventsToday?.trim() || buildEventStreamTodayUrl(appOrigin, fromMs, toMs),
  };
}
