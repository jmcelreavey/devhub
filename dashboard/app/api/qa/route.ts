import { after, NextRequest, NextResponse } from "next/server";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { typesafeApiKey } from "@/lib/qa/credentials";
import { QaPostSchema } from "@/lib/qa/schema";
import { listScenarios, readSettings, saveScenario, saveSettings } from "@/lib/qa/store";
import { cancelQaRun, prepareQaRun, qaRunsWithRecovery } from "@/lib/qa/service";
import { qaModelChoices, validateQaSettings } from "@/lib/qa/models";
import { storyboardError } from "@/lib/storyboard/http";

export const dynamic = "force-dynamic";
export const maxDuration = 660;
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    scenarios: listScenarios(), runs: await qaRunsWithRecovery(), settings: readSettings(),
    models: await qaModelChoices(), defaultModel: process.env.AI_MODEL ?? "",
    configured: { jev: Boolean(typesafeApiKey()), vision: Boolean(process.env.AI_API_KEY), desktop: process.platform === "darwin" },
  }, { headers: { "Cache-Control": "no-store" } });
}, "qa.get");
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, QaPostSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const input = parsed.data;
    if (input.action === "scenario") { saveScenario(input.scenario); return NextResponse.json({ ok: true }); }
    if (input.action === "settings") {
      await validateQaSettings(input.settings);
      saveSettings(input.settings);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "cancel") return NextResponse.json({ cancelled: cancelQaRun(input.id) });
    const { run, execute } = prepareQaRun(input);
    if (execute) after(execute);
    return NextResponse.json({ run }, { status: execute ? 202 : 200 });
  } catch (error) { return storyboardError(error); }
}, "qa.post");
