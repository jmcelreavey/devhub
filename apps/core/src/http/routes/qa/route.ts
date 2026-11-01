import { runBackground } from "@devhub/core/http/background";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { httpAction } from "../../../lib/actions/http";
import { storyboardJevRun } from "../../../../../../packages/shared/actions/storyboard";
import { qaRead } from "../../../../../../packages/shared/actions/misc-ui";
import { typesafeApiKey } from "../../../lib/qa/credentials";
import { QaPostSchema } from "../../../lib/qa/schema";
import { listScenarios, readSettings, saveScenario, saveSettings } from "../../../lib/qa/store";
import { cancelQaRun, prepareQaRun, qaRunsWithRecovery } from "../../../lib/qa/service";
import { qaModelChoices, validateQaSettings } from "../../../lib/qa/models";
import { storyboardError } from "../../../lib/storyboard/http";

export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const scope = new URL(req.url).searchParams.get("scope");
  return await qaRead.handler({ scope }, { execute: ({ scope: selectedScope }) => readQa(selectedScope) }) as Response;
}, "qa.get");

async function readQa(scope: string | null) {
  if (scope === "models") return Response.json({ models: await qaModelChoices() }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({
    scenarios: listScenarios(), runs: await qaRunsWithRecovery(), settings: readSettings(),
    ...(scope === "local" ? {} : { models: await qaModelChoices() }), defaultModel: process.env.AI_MODEL ?? "",
    configured: { jev: Boolean(typesafeApiKey()), vision: Boolean(process.env.AI_API_KEY), desktop: process.platform === "darwin" },
  }, { headers: { "Cache-Control": "no-store" } });
}
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, QaPostSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const input = parsed.data;
    if (input.action === "scenario") { saveScenario(input.scenario); return Response.json({ ok: true }); }
    if (input.action === "settings") {
      await validateQaSettings(input.settings);
      saveSettings(input.settings);
      return Response.json({ ok: true });
    }
    if (input.action === "cancel") return Response.json({ cancelled: cancelQaRun(input.id) });
    return httpAction(storyboardJevRun, {
      input: () => ({ scenarioId: input.scenarioId, taskId: input.taskId, baseline: input.baseline }),
      context: () => ({ run: async () => {
        try {
          const { run, execute } = prepareQaRun(input);
          if (execute) runBackground("qa", execute);
          return { status: execute ? 202 : 200, body: { run } };
        } catch (error) {
          const response = storyboardError(error);
          return { status: response.status, body: await response.json() };
        }
      } }),
      response: ({ status, body }) => Response.json(body, { status, ...(status >= 400 ? { headers: { "Cache-Control": "no-store" } } : {}) }),
    })(req);
  } catch (error) { return storyboardError(error); }
}, "qa.post");
