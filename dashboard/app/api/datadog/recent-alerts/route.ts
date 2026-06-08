import { NextResponse } from "next/server";
import { loadRecentAlerts } from "@/lib/datadog-recent-server";
import type { DatadogRecentAlertsResponse } from "@/lib/datadog-recent-events";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadRecentAlerts(5);
  if (!result.ok) {
    const payload: DatadogRecentAlertsResponse = result;
    return NextResponse.json(payload);
  }
  const payload: DatadogRecentAlertsResponse = {
    ok: true,
    fetchedAt: new Date().toISOString(),
    ddSite: result.ddSite,
    oncall: result.oncall,
    teamSlack: result.teamSlack,
  };
  return NextResponse.json(payload);
}
