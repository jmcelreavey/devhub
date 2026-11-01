import { taskReadyPrs } from "../../../../../../../packages/shared/actions/tasks";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { readyLinkedDraftPrs } from "../../../../domains/tasks/ready-linked-prs";


/** Mark a task's own open draft PRs ready for review (the completion safety net, on demand). */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskReadyPrs.input);
  if (!parsed.ok) return parsed.response;
  return taskReadyPrs.handler(parsed.data, { execute: async ({ taskId, reason }) => {
    const outcomes = await readyLinkedDraftPrs(taskId, reason ?? "task completed");
    return Response.json({ outcomes });
  } });
}, "tasks.readyPrs.post");
