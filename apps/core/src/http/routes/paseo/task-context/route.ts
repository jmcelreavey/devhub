import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { paseoTaskContext, paseoTaskContextInput } from "../../../../../../../packages/shared/actions/paseo";
import { taskContextSnapshots } from "../../../../lib/paseo/task-context";
export const GET = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request); if (!auth.ok) return auth.response;
  const parsed = paseoTaskContextInput.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Use a task identifier or a shorter search." }, { status: 400 });
  return httpAction(paseoTaskContext, {
    input: () => parsed.data,
    context: () => ({ read: (input) => taskContextSnapshots({ ...input, origin: new URL(request.url).origin }) }),
    response: (body) => Response.json(body, { headers: { "Cache-Control": "no-store" } }),
  })(request);
}, "paseo.taskContext");
