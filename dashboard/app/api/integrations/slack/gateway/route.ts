import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginStrict, parseBody, requireDashboardAuth } from "@/lib/api-utils";
import { confirmGatewayBinding, registerGatewayDevice, revokeGatewayDevice, gatewayStateRoot } from "@/lib/integrations/slack/gateway-state";
import { saveSlackSettings } from "@/lib/integrations/slack/settings";
import { restartSlackBot, slackStatus, unlinkSlackGateway } from "@/lib/integrations/slack/runtime";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { SlackSettingsSchema } from "@/lib/integrations/slack/shared";

export const dynamic = "force-dynamic";
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), url: SlackSettingsSchema.shape.gatewayUrl.unwrap().refine(Boolean) }).strict(),
  z.object({ action: z.literal("unlink") }).strict(),
  z.object({ action: z.literal("confirm"), deviceId: z.string().uuid(), userId: z.string().regex(/^[UW][A-Z0-9]+$/) }).strict(),
]);

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Manage Team Slack in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, Input);
  if (!parsed.ok) return parsed.response;
  try {
    await withPluginMutationLock(`${gatewayStateRoot()}-pairing`, async () => {
      if (parsed.data.action === "connect") {
        await registerGatewayDevice(parsed.data.url);
        saveSlackSettings({ mode: "gateway", gatewayUrl: parsed.data.url });
      } else if (parsed.data.action === "confirm") {
        confirmGatewayBinding(parsed.data.deviceId, parsed.data.userId);
      } else {
        await unlinkSlackGateway();
        revokeGatewayDevice();
      }
      restartSlackBot();
    });
    return NextResponse.json(slackStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Couldn't connect or unlink Team Slack. Check the gateway URL and connection, then try again." }, { status: 502, headers: { "Cache-Control": "no-store" } }); }
}
