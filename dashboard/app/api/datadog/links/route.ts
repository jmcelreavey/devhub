import { NextResponse } from "next/server";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { resolveDatadogDeepLinks } from "@/lib/datadog-links";

export const dynamic = "force-dynamic";

export async function GET() {
  const { overrides } = readDashboardEnvLocalFile();
  const configured = !!resolveEnvValue("DATADOG_API_KEY", overrides);

  if (!configured) {
    return NextResponse.json({
      configured: false as const,
    });
  }

  const pick = (key: string) => resolveEnvValue(key, overrides) ?? process.env[key]?.trim();

  const ddSite = pick("DD_SITE") ?? "datadoghq.com";
  const links = resolveDatadogDeepLinks({
    ddSite,
    appOriginOverride: pick("DATADOG_APP_ORIGIN"),
    linkOncall: pick("DATADOG_LINK_ONCALL"),
    linkTeamAlerts: pick("DATADOG_LINK_TEAM_ALERTS"),
    linkEventsToday: pick("DATADOG_LINK_EVENTS_TODAY"),
  });

  return NextResponse.json({
    configured: true as const,
    ddSite,
    ...links,
  });
}
