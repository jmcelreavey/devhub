import { NextRequest, NextResponse } from "next/server";
import { isSameOriginStrict, parseBody, requireDashboardAuth } from "@/lib/api-utils";
import { SlackTestSchema } from "@/lib/integrations/slack/shared";
import { sendSlackTest } from "@/lib/integrations/slack/test-message";
import { IntegrationError } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Send a Slack test from DevHub." }, { status: 403 });
  const parsed = await parseBody(req, SlackTestSchema);
  if (!parsed.ok) return parsed.response;
  try { return NextResponse.json({ delivery: await sendSlackTest(parsed.data) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    return NextResponse.json({ error: error instanceof IntegrationError ? error.message : "Could not send the Slack test. Check the channel before trying again." }, { status: error instanceof IntegrationError && error.kind === "conflict" ? 409 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
