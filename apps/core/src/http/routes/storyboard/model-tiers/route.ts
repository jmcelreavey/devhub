import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardModelTiersGet, storyboardModelTiersSet } from "../../../../../../../packages/shared/actions/storyboard";
import { ModelTierSettingsSchema, readModelTiers, writeModelTiers } from "../../../../lib/storyboard/model-tiers";


/** Saved cheap/mid/heavy defaults used when a task starts Implement on auto. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(storyboardModelTiersGet, {
    input: () => ({}),
    context: () => ({
      readDefault: () => readModelTiers(),
      readTask: () => { throw new Error("Task-specific tiers use the orchestration endpoint."); },
    }),
    response: (result) => {
      if (result.kind !== "settings") throw new Error("Unexpected model tier result.");
      return Response.json({ settings: result.settings });
    },
  })(req);
}, "storyboard.modelTiers.get");

export const PUT = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ModelTierSettingsSchema);
  if (!parsed.ok) return parsed.response;
  return httpAction(storyboardModelTiersSet, {
    input: () => parsed.data,
    context: () => ({ set: () => writeModelTiers(parsed.data) }),
    response: (settings) => Response.json({ settings }),
  })(req);
}, "storyboard.modelTiers.put");
