import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { taskAgentHandoffGet, taskAgentHandoffSet } from "../../../../../../../../packages/shared/actions/task-agent";
import {
  getTaskAgentHandoff,
  isValidTaskAgentTaskId,
  setTaskAgentHandoff,
} from "../../../../../domains/tasks/task-agent-runs";


/** Read durable handoff markdown for a task (resume reads this first). */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const taskId = new URL(req.url).searchParams.get("taskId")?.trim() ?? "";
  if (!taskId) return Response.json({ error: "taskId required" }, { status: 400 });
  if (!isValidTaskAgentTaskId(taskId)) {
    return Response.json({ error: "invalid taskId" }, { status: 400 });
  }
  return httpAction(taskAgentHandoffGet, {
    input: () => ({ taskId }),
    context: () => ({ read: async (id) => ({ ok: true, value: getTaskAgentHandoff(id) }) }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "tasks.agentHandoff.get");

/** Write/replace or append handoff before pause / EOD / abandon. */
export const PUT = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskAgentHandoffSet.input);
  if (!parsed.ok) return parsed.response;
  if (!isValidTaskAgentTaskId(parsed.data.taskId)) {
    return Response.json({ error: "invalid taskId" }, { status: 400 });
  }
  return httpAction(taskAgentHandoffSet, {
    input: () => parsed.data,
    context: () => ({ write: async ({ taskId, handoff, mode }) => {
      try {
        await setTaskAgentHandoff(taskId, handoff, { mode });
        return { ok: true, value: getTaskAgentHandoff(taskId) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "handoff update failed", status: 400 };
      }
    } }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "tasks.agentHandoff.put");
