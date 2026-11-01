import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardStopWork, storyboardStopWorkInput } from "../../../../../../../packages/shared/actions/storyboard";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";
import { stopTaskWork } from "../../../../lib/storyboard/stop-task-work";
import { resolveReopenTask } from "../../../../domains/tasks/reopen-task";

/** Pause auto and stop the task's live runs, keeping its worktree, note and history. */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, storyboardStopWorkInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(storyboardStopWork, {
    input: () => parsed.data,
    context: () => ({ stop: async (taskId) => {
      try {
        const task = await resolveReopenTask(taskId);
        await stopTaskWork(task.id);
        return { status: 200, body: { ok: true } };
      } catch (error) {
        const response = storyboardError(error);
        return { status: response.status, body: await response.json() };
      }
    } }),
    response: ({ status, body }) => storyboardJson(body, status),
  })(req);
}, "storyboard.stop-work");
