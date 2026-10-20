import { after, NextRequest, NextResponse } from "next/server";
import { parseBody, requireDashboardAuth, isSameOriginStrict, withErrorHandler } from "@/lib/api-utils";
import { ensureTasksMigrated } from "@/lib/tasks/storage";
import { currentTaskNode, loadTaskIndex, taskLineageIds } from "@/lib/tasks/task-index";
import { listTaskAgentRuns } from "@/lib/tasks/task-agent-runs";
import { reconcileTaskAgentRunSidecar } from "@/lib/tasks/reconcile-task-agent-sidecar";
import { listWorkflows } from "@/lib/workflows/store";
import { actOnWorkflow, executeWorkflowCheck, recoverWorkflowRuns, refreshWorkflowEvidence, WorkflowAction } from "@/lib/workflows/service";

import { taskRefs } from "@/lib/integrations/task-refs";
import { providers } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

async function taskFor(id: string) {
  await ensureTasksMigrated();
  return currentTaskNode(loadTaskIndex(), id)?.task;
}
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const id = req.nextUrl.searchParams.get("taskId");
  if (!id) {
    await ensureTasksMigrated();
    const index = loadTaskIndex();
    const items = listWorkflows().flatMap((workflow) => {
      const node = currentTaskNode(index, workflow.taskId);
      if (!node || node.task.id !== workflow.taskId) return [];
      // The whole task, so the inbox can offer the same task menu as a task row.
      return [{ task: { ...node.task, date: node.task.startDate }, workflow }];
    });
    return NextResponse.json({ items });
  }
  const task = await taskFor(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  await recoverWorkflowRuns(task.id, taskLineageIds(loadTaskIndex(), task.id));
  await reconcileTaskAgentRunSidecar(task.id);
  return NextResponse.json({ task: { id: task.id, text: task.text, date: task.startDate, integrationRefs: taskRefs(task) }, integrationProviders: providers().map((p) => ({ id: p.id, capabilities: p.capabilities })), workflow: await refreshWorkflowEvidence(task.id), runs: listTaskAgentRuns(task.id) });
}, "tasks.workflow.get");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, WorkflowAction);
  if (!parsed.ok) return parsed.response;
  const task = await taskFor(parsed.data.taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  // Keep the decision UI separate from the agent's API credential. This is
  // coordination, not isolation: an unrestricted local process can forge Origin.
  if (parsed.data.action === "decide" && !isSameOriginStrict(req)) return NextResponse.json({ error: "Decide in the DevHub dashboard." }, { status: 403 });
  try {
    const result = await actOnWorkflow({ ...parsed.data, taskId: task.id });
    if (result.checkId) {
      const checkId = result.checkId;
      after(() => executeWorkflowCheck(task.id, checkId));
    }
    return NextResponse.json(result, { status: result.checkId ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Workflow action failed" }, { status: 409 });
  }
}, "tasks.workflow.post");
