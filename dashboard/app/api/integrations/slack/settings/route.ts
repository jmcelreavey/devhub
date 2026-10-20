import { NextRequest, NextResponse } from "next/server";
import { isSameOriginStrict, parseBody, requireDashboardAuth } from "@/lib/api-utils";
import { SlackSettingsSchema } from "@/lib/integrations/slack/shared";
import { saveSlackSettings } from "@/lib/integrations/slack/settings";
import { restartSlackBot, slackStatus } from "@/lib/integrations/slack/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Manage Slack settings in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, SlackSettingsSchema.nullable());
  if (!parsed.ok) return parsed.response;
  try {
    saveSlackSettings(parsed.data);
    restartSlackBot();
    return NextResponse.json(slackStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not save Slack settings. Check Setup and try again." }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
}
