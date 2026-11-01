import { requireDashboardAuth, isSameOriginStrict, parseBody } from "../../../../lib/api-utils";
import { getTaskProfileOverview } from "../../../../domains/tasks/profiles";
import { WriteInputSchema } from "../../../../lib/integrations/write-types";
import { writeNow } from "../../../../lib/integrations/write-store";
import { directOutcome, integrationFailure } from "../../../../lib/integrations/write-api";
import { httpAction } from "../../../../lib/actions/http";
import { integrationProviderWrite, integrationsWrite, integrationsWriteInput } from "../../../../../../../packages/shared/actions/integrations";

export async function POST(req: Request) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return Response.json({ error: "Use a same-origin request." }, { status: 403 });
  const parsed = await parseBody(req, WriteInputSchema); if (!parsed.ok) return parsed.response;
  const adapter = {
    input: () => ({ input: parsed.data }),
    context: () => ({ write: async () => {
      try {
        return directOutcome(await writeNow(parsed.data, getTaskProfileOverview().active ?? "default", req.signal), {});
      } catch (error) { return integrationFailure(error); }
    } }),
    response: (result: unknown) => result as Response,
  };
  return integrationsWriteInput.safeParse({ input: parsed.data }).success
    ? httpAction(integrationsWrite, adapter)(req)
    : httpAction(integrationProviderWrite, adapter)(req);
}
