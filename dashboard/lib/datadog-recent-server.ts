import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import {
  DATADOG_EVENTS_QUERY_ONCALL_24H,
  DATADOG_EVENTS_QUERY_TEAM_ALERTS_24H,
  datadogApiHost,
} from "@/lib/datadog-links";
import { fetchRecentEvents, type RecentEvent } from "@/lib/datadog-recent-events";
import { resolveDatadogApplicationKey } from "@/lib/datadog-application-key";

export type RecentAlertsLoad =
  | { ok: true; ddSite: string; oncall: RecentEvent[]; teamSlack: RecentEvent[] }
  | { ok: false; code: "not_configured" | "needs_application_key" | "upstream"; message: string };

/** Resolve Datadog credentials and fetch recent on-call + team alerts (last 24h). */
export async function loadRecentAlerts(limit = 5): Promise<RecentAlertsLoad> {
  const { overrides } = readDashboardEnvLocalFile();
  const apiKey = resolveEnvValue("DATADOG_API_KEY", overrides);
  if (!apiKey) {
    return { ok: false, code: "not_configured", message: "Datadog API key is not configured." };
  }

  const applicationKey = resolveDatadogApplicationKey(overrides);
  if (!applicationKey) {
    return {
      ok: false,
      code: "needs_application_key",
      message:
        "Add an application key in Setup, or set DATADOG_APPLICATION_KEY / DD_APPLICATION_KEY so DevHub can call the Events API.",
    };
  }

  const pick = (key: string) => resolveEnvValue(key, overrides) ?? process.env[key]?.trim();
  const ddSite = pick("DD_SITE") ?? "datadoghq.com";
  const apiHost = datadogApiHost(ddSite);
  const qOncall = pick("DATADOG_EVENTS_QUERY_ONCALL") ?? DATADOG_EVENTS_QUERY_ONCALL_24H;
  const qTeam = pick("DATADOG_EVENTS_QUERY_TEAM") ?? DATADOG_EVENTS_QUERY_TEAM_ALERTS_24H;

  const [oncall, teamSlack] = await Promise.all([
    fetchRecentEvents(apiHost, apiKey, applicationKey, qOncall, limit),
    fetchRecentEvents(apiHost, apiKey, applicationKey, qTeam, limit),
  ]);

  const firstErr = [oncall, teamSlack].find((b) => b.error);
  if (firstErr?.error) {
    return { ok: false, code: "upstream", message: firstErr.error };
  }

  return { ok: true, ddSite, oncall: oncall.events, teamSlack: teamSlack.events };
}
