import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { taskAgentRuns, taskAgentRunsList, type TaskAgentRunsContext } from "../../../../../../../packages/shared/actions/task-agent";
import {
  isTaskAgentRunStatus,
  isValidTaskAgentRunId,
  isValidTaskAgentTaskId,
  listTaskAgentRuns,
  upsertTaskAgentRun,
} from "../../../../domains/tasks/task-agent-runs";
import { reconcileTaskAgentRunSidecar } from "../../../../domains/tasks/reconcile-task-agent-sidecar";


const agentRunsContext = (startedAt?: string): TaskAgentRunsContext => ({
  list: async (taskId) => {
    const file = await reconcileTaskAgentRunSidecar(taskId);
    return { ok: true, value: { taskId, handoff: file.handoff, handoffUpdatedAt: file.handoffUpdatedAt ?? null, runs: listTaskAgentRuns(taskId) } };
  },
  upsert: async (input) => {
    try {
      const file = await upsertTaskAgentRun({ ...input, startedAt });
      return { ok: true, value: { taskId: file.taskId, handoff: file.handoff, handoffUpdatedAt: file.handoffUpdatedAt ?? null, runs: listTaskAgentRuns(file.taskId) } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "upsert failed", status: 400 };
    }
  },
});

/** List agent runs + handoff linked to a task. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const taskId = new URL(req.url).searchParams.get("taskId")?.trim() ?? "";
  if (!taskId) return Response.json({ error: "taskId required" }, { status: 400 });
  if (!isValidTaskAgentTaskId(taskId)) {
    return Response.json({ error: "invalid taskId" }, { status: 400 });
  }
  return httpAction(taskAgentRunsList, {
    input: () => ({ taskId }),
    context: () => agentRunsContext(),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "tasks.agentRuns.get");

const UpsertSchema = taskAgentRuns.input.extend({
  runId: z.string().trim().min(1).max(64),
  prUrl: z.string().trim().url().max(2_000).nullable().optional(),
  startedAt: z.string().datetime().optional(),
});

/** Link or update a task ↔ agent-run record (optional handoff in the same write). */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, UpsertSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!isValidTaskAgentTaskId(body.taskId)) {
    return Response.json({ error: "invalid taskId" }, { status: 400 });
  }
  if (!isValidTaskAgentRunId(body.runId)) {
    return Response.json({ error: "invalid runId" }, { status: 400 });
  }
  if (body.status && !isTaskAgentRunStatus(body.status)) {
    return Response.json({ error: "invalid status" }, { status: 400 });
  }
  return httpAction(taskAgentRuns, {
    input: () => body,
    context: () => agentRunsContext(body.startedAt),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "tasks.agentRuns.post");
