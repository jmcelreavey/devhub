import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { taskPrWatch } from "../../../../../../../packages/shared/actions/plans";
import { watchTaskPrs } from "../../../../domains/tasks/task-pr-watch";


/** Check every task-linked agent PR now instead of waiting for the next poll. */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(taskPrWatch, {
    input: () => ({ action: "check" }),
    context: () => ({
      check: () => watchTaskPrs(),
      dismiss: async () => { throw new Error("Dismissal uses the task PR attention endpoint."); },
    }),
    response: (result) => {
      if (result.kind !== "checked") throw new Error("Unexpected PR watch result.");
      return Response.json(result.report);
    },
  })(req);
}, "tasks.prWatch.post");
