import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { taskPlanStatus } from "../../../../../../../packages/shared/actions/plans";
import { buildPlanStatus, formatPlanStatus } from "../../../../domains/tasks/plan-status";
import { ensureTasksMigrated } from "../../../../domains/tasks/storage";


/** Open tasks grouped by where they are in the plan loop. `?format=text` for a plain report. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const date = new URL(req.url).searchParams.get("date")?.trim() || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  return httpAction(taskPlanStatus, {
    input: () => ({ date }),
    context: () => ({ read: async (day) => {
      await ensureTasksMigrated();
      const status = buildPlanStatus(day);
      return new URL(req.url).searchParams.get("format") === "text" ? { text: formatPlanStatus(status) } : status;
    } }),
    response: (result) => Response.json(result),
  })(req);
}, "tasks.planStatus.get");
