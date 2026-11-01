import { runBackground } from "@devhub/core/http/background";
import { parseBody, requireDashboardAuth, isSameOriginStrict, withErrorHandler } from "../../../../lib/api-utils";
import { ensureTasksMigrated } from "../../../../domains/tasks/storage";
import { currentTaskNode, loadTaskIndex, taskLineageIds } from "../../../../domains/tasks/task-index";
import { listTaskAgentRuns } from "../../../../domains/tasks/task-agent-runs";
import { reconcileTaskAgentRunSidecar } from "../../../../domains/tasks/reconcile-task-agent-sidecar";
import { listWorkflows } from "../../../../lib/workflows/store";
import { actOnWorkflow, executeWorkflowCheck, recoverWorkflowRuns, refreshWorkflowEvidence, WorkflowAction } from "../../../../lib/workflows/service";

import { taskRefs } from "../../../../lib/integrations/task-refs";
import { providers } from "../../../../lib/integrations/registry";
import type { z } from "zod";
import type { ActionDefinition } from "../../../../../../../packages/shared/actions/define";
import {
  taskWorkflowBegin, taskWorkflowDecide, taskWorkflowGet, taskWorkflowPropose, taskWorkflowReceipt,
  taskWorkflowReview, taskWorkflowSeen, taskWorkflowStatus, taskWorkflowUnseen, taskWorkflowVerify,
  type WorkflowActionInput, type WorkflowOutcome, type WorkflowWriteContext,
} from "../../../../../../../packages/shared/actions/workflows";
import { httpAction } from "../../../../lib/actions/http";


async function taskFor(id: string) {
  await ensureTasksMigrated();
  return currentTaskNode(loadTaskIndex(), id)?.task;
}
async function readWorkflow(id?: string): Promise<WorkflowOutcome> {
  if (!id) {
    await ensureTasksMigrated();
    const index = loadTaskIndex();
    const items = listWorkflows().flatMap((workflow) => {
      const node = currentTaskNode(index, workflow.taskId);
      if (!node || node.task.id !== workflow.taskId) return [];
      // The whole task, so the inbox can offer the same task menu as a task row.
      return [{ task: { ...node.task, date: node.task.startDate }, workflow }];
    });
    return { ok: true, value: { items }, status: 200 };
  }
  const task = await taskFor(id);
  if (!task) return { ok: false, error: "Task not found", status: 404 };
  await recoverWorkflowRuns(task.id, taskLineageIds(loadTaskIndex(), task.id));
  await reconcileTaskAgentRunSidecar(task.id);
  return { ok: true, status: 200, value: { task: { id: task.id, text: task.text, date: task.startDate, integrationRefs: taskRefs(task) }, integrationProviders: providers().map((p) => ({ id: p.id, capabilities: p.capabilities })), workflow: await refreshWorkflowEvidence(task.id), runs: listTaskAgentRuns(task.id) } };
}

function workflowResponse(result: WorkflowOutcome): Response {
  return result.ok
    ? Response.json(result.value, { status: result.status })
    : Response.json({ error: result.error }, { status: result.status });
}

export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const input = { taskId: new URL(req.url).searchParams.get("taskId") || undefined };
  if (!taskWorkflowGet.input.safeParse(input).success) return workflowResponse(await readWorkflow(input.taskId));
  return httpAction(taskWorkflowGet, {
    input: () => input,
    context: () => ({ read: readWorkflow }),
    response: workflowResponse,
  })(req);
}, "tasks.workflow.get");

async function executeWorkflow(input: WorkflowActionInput, req: Request): Promise<WorkflowOutcome> {
  const task = await taskFor(input.taskId);
  if (!task) return { ok: false, error: "Task not found", status: 404 };
  // Keep the decision UI separate from the agent's API credential. This is
  // coordination, not isolation: an unrestricted local process can forge Origin.
  if (input.action === "decide" && !isSameOriginStrict(req)) return { ok: false, error: "Decide in the DevHub dashboard.", status: 403 };
  try {
    const result = await actOnWorkflow({ ...input, taskId: task.id });
    if (result.checkId) {
      const checkId = result.checkId;
      runBackground("tasks/workflow", () => executeWorkflowCheck(task.id, checkId));
    }
    return { ok: true, value: result, status: result.checkId ? 202 : 200 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Workflow action failed", status: 409 };
  }
}

function runWorkflowAction<Schema extends z.ZodObject>(
  action: ActionDefinition<Schema, WorkflowWriteContext, WorkflowOutcome>,
  input: unknown,
  req: Request,
): Promise<Response> {
  return httpAction(action, {
    input: () => input,
    context: () => ({ execute: (value) => executeWorkflow(value, req) }),
    response: workflowResponse,
  })(req);
}

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, WorkflowAction);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  switch (input.action) {
    case "verify": return runWorkflowAction(taskWorkflowVerify, input, req);
    case "review":
      return taskWorkflowReview.input.safeParse(input).success
        ? runWorkflowAction(taskWorkflowReview, input, req)
        : workflowResponse(await executeWorkflow(input, req));
    case "propose": return runWorkflowAction(taskWorkflowPropose, input, req);
    case "decide": return runWorkflowAction(taskWorkflowDecide, input, req);
    case "status": return runWorkflowAction(taskWorkflowStatus, input, req);
    case "seen": return runWorkflowAction(taskWorkflowSeen, input, req);
    case "unseen": return runWorkflowAction(taskWorkflowUnseen, input, req);
    case "begin": return runWorkflowAction(taskWorkflowBegin, input, req);
    case "receipt": return runWorkflowAction(taskWorkflowReceipt, input, req);
  }
}, "tasks.workflow.post");
