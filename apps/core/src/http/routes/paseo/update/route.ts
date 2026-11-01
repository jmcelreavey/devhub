import { requireDashboardAuth } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { paseoUpdate } from "../../../../../../../packages/shared/actions/paseo";
import { checkPaseoUpdate } from "../../../../lib/paseo/update";
export async function GET(req: Request) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(paseoUpdate, {
    input: () => ({}),
    context: () => ({ check: checkPaseoUpdate }),
    response: (body) => Response.json(body, { headers: { "Cache-Control": "no-store" } }),
  })(req);
}
