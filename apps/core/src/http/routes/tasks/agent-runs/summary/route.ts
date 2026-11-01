import { taskAgentRunSummary } from "../../../../../../../../packages/shared/actions/tasks";
import { requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import {
  listTaskAgentRunTaskIds,
  listTaskAgentRuns,
  latestImplementationRun,
  type TaskAgentRunSummaries,
} from "../../../../../domains/tasks/task-agent-runs";
import { reconcileTaskAgentRunSidecar } from "../../../../../domains/tasks/reconcile-task-agent-sidecar";


/** Latest linked run + handoff for every task with agent history — one poll for all task rows. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return taskAgentRunSummary.handler(taskAgentRunSummary.input.parse({}), { execute: async () => {
    const tasks: TaskAgentRunSummaries = {};
    for (const taskId of listTaskAgentRunTaskIds()) {
      const file = await reconcileTaskAgentRunSidecar(taskId);
      tasks[taskId] = { handoff: file.handoff, latestRun: latestImplementationRun(listTaskAgentRuns(taskId)) };
    }
    return Response.json({ tasks });
  } });
}, "tasks.agentRuns.summary.get");
