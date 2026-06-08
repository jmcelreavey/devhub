import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import {
  datadogApiBaseUrl,
  datadogApiHost,
  datadogAuthHeaders,
  datadogErrorMessage,
} from "@/lib/datadog-links";
import { resolveDatadogApplicationKey } from "@/lib/datadog-application-key";
import {
  emailMatches,
  extractOncallUsers,
  extractScheduleIds,
  parseScheduleIds,
  type OncallStatus,
  type OncallUser,
} from "@/lib/datadog-oncall";

/** Cap on auto-discovered schedules we'll probe per check (override scopes past this). */
const MAX_DISCOVERED_SCHEDULES = 100;

/**
 * Ask Datadog who is on call for the configured schedule(s) and decide whether
 * the configured identity (`BI_OPS_USER_EMAIL`) is carrying the pager.
 *
 * Fail-closed: any missing config or upstream error returns `ok: false` so
 * callers (briefing, Today strip) stay quiet rather than guessing.
 */
export async function loadOncallStatus(): Promise<OncallStatus> {
  const { overrides } = readDashboardEnvLocalFile();
  const pick = (key: string) => resolveEnvValue(key, overrides) ?? process.env[key]?.trim();

  const apiKey = resolveEnvValue("DATADOG_API_KEY", overrides);
  if (!apiKey) {
    return { ok: false, code: "not_configured", message: "Datadog API key is not configured." };
  }

  const applicationKey = resolveDatadogApplicationKey(overrides);
  if (!applicationKey) {
    return {
      ok: false,
      code: "needs_application_key",
      message: "Add an application key in Setup so DevHub can call the On-Call API.",
    };
  }

  // Use the explicitly-configured identity only — the git fallback in
  // getDefaultUserEmail() could disagree with the Datadog account.
  const email = pick("BI_OPS_USER_EMAIL");
  if (!email) {
    return {
      ok: false,
      code: "needs_email",
      message: "Set your work email in Setup so DevHub can match you against the on-call schedule.",
    };
  }

  const ddSite = pick("DD_SITE") ?? "datadoghq.com";
  const base = datadogApiBaseUrl(datadogApiHost(ddSite));
  const headers = datadogAuthHeaders(apiKey, applicationKey);
  const nowIso = new Date().toISOString();

  try {
    // Prefer an explicit override (scopes/skips discovery in large orgs);
    // otherwise auto-discover every schedule and let the email match decide.
    let scheduleIds = parseScheduleIds(pick("DATADOG_ONCALL_SCHEDULE_ID"));
    if (scheduleIds.length === 0) {
      const res = await fetch(`${base}/api/v2/on-call/schedules?page%5Bsize%5D=${MAX_DISCOVERED_SCHEDULES}`, {
        headers,
      });
      if (!res.ok) {
        throw new Error(datadogErrorMessage(await res.json().catch(() => ({})), `${res.status} ${res.statusText}`));
      }
      scheduleIds = extractScheduleIds(await res.json());
    }

    if (scheduleIds.length === 0) {
      return { ok: true, onCall: false, users: [], checkedAt: nowIso };
    }

    // Per-schedule failures are tolerated (e.g. a coverage gap): discovery
    // already proved the creds work, so one bad schedule shouldn't blind the
    // whole check and hide a real shift on another schedule.
    const rosters = await Promise.all(
      scheduleIds.map(async (id) => {
        try {
          const url = `${base}/api/v2/on-call/schedules/${encodeURIComponent(id)}/on-call?include=user&filter%5Bat_ts%5D=${encodeURIComponent(nowIso)}`;
          const res = await fetch(url, { headers });
          if (!res.ok) return [] as OncallUser[];
          return extractOncallUsers(await res.json());
        } catch {
          return [] as OncallUser[];
        }
      }),
    );

    const seen = new Map<string, OncallUser>();
    for (const roster of rosters) {
      for (const user of roster) {
        if (!seen.has(user.email.toLowerCase())) seen.set(user.email.toLowerCase(), user);
      }
    }
    const users = [...seen.values()];

    return { ok: true, onCall: emailMatches(users, email), users, checkedAt: nowIso };
  } catch (e) {
    return {
      ok: false,
      code: "upstream",
      message: e instanceof Error ? e.message : "Datadog On-Call request failed",
    };
  }
}
