import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { taskRetroInputs } from "../../../../../../../packages/shared/actions/plans";
import { buildRetroInputs } from "../../../../domains/tasks/retro-inputs";


/** Inputs for the plan retro: finished/abandoned tasks, run outcomes, MCP failures, skills. `?days=7` (1–31). */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const days = Number.parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10);
  if (!Number.isFinite(days)) return Response.json(await buildRetroInputs(days));
  return httpAction(taskRetroInputs, {
    input: () => ({ days: Math.max(1, Math.min(days, 31)) }),
    context: () => ({ read: (value) => buildRetroInputs(value) }),
    response: (result) => Response.json(result),
  })(req);
}, "tasks.retro.get");
