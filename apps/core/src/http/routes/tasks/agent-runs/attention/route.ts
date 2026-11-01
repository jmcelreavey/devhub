import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { taskPrAttention } from "../../../../../../../../packages/shared/actions/plans";
import { isValidTaskAgentRunId, isValidTaskAgentTaskId } from "../../../../../domains/tasks/task-agent-runs";
import { handleTaskPrAttention } from "../../../../../domains/tasks/task-pr-watch";


/**
 * Mark a run's PR attention handled — dismissed, or the agent was sent back to
 * fix it. It stays quiet until the PR head or the finding changes.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskPrAttention.input);
  if (!parsed.ok) return parsed.response;
  const { taskId, runId } = parsed.data;
  if (!isValidTaskAgentTaskId(taskId) || !isValidTaskAgentRunId(runId)) {
    return Response.json({ error: "invalid taskId or runId" }, { status: 400 });
  }
  return httpAction(taskPrAttention, {
    input: () => parsed.data,
    context: () => ({ dismiss: handleTaskPrAttention }),
    response: (run) => run ? Response.json({ run }) : Response.json({ error: "run not linked to task" }, { status: 404 }),
  })(req);
}, "tasks.agentRuns.attention.post");
