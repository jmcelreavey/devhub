import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import { slackUsageTotals } from "@/lib/integrations/slack/usage-log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  try { return NextResponse.json(slackUsageTotals(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Could not read Slack usage." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
