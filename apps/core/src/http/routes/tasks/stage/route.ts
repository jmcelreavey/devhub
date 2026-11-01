import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { taskSetStage, taskSetStageBodyInput } from "../../../../../../../packages/shared/actions/plans";
import { getTasks, updateTask, ensureTasksMigrated } from "../../../../domains/tasks/storage";
import { checkTaskImplementReady } from "../../../../domains/tasks/implement-ready-gather";


/**
 * Move a task between draft and ready. Ready means an agent can run the plan
 * without design questions, so it goes through the implement checklist first
 * (409 with the failing items unless `force`).
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskSetStageBodyInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(taskSetStage, {
    input: () => parsed.data,
    context: () => ({ setStage: async ({ taskId, date, stage, force }) => {
      await ensureTasksMigrated();
      const task = getTasks(date).find((item) => item.id === taskId);
      if (!task) return { status: 404, body: { error: `Task ${taskId} not found on ${date}` } };
      if (stage === "ready" && !force) {
        const ready = await checkTaskImplementReady(task, date, { hardBlock: true, requirePlanSection: true });
        if (!ready.ok) {
          const gaps = ready.items.filter((item) => !item.ok);
          return { status: 409, body: { error: `Not ready: ${gaps.map((item) => item.label).join(", ")}`, items: gaps } };
        }
      }
      const updated = await updateTask(taskId, { stage }, date);
      return updated ? { status: 200, body: updated } : { status: 404, body: { error: `Task ${taskId} not found on ${date}` } };
    } }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}, "tasks.stage.post");
