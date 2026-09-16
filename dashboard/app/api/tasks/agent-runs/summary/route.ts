import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  listTaskAgentRunTaskIds,
  listTaskAgentRuns,
  type TaskAgentRunSummaries,
} from "@/lib/tasks/task-agent-runs";
import { reconcileTaskAgentRunSidecar } from "@/lib/tasks/reconcile-task-agent-sidecar";

export const dynamic = "force-dynamic";

/** Latest linked run + handoff for every task with agent history — one poll for all task rows. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const tasks: TaskAgentRunSummaries = {};
  for (const taskId of listTaskAgentRunTaskIds()) {
    const file = await reconcileTaskAgentRunSidecar(taskId);
    tasks[taskId] = { handoff: file.handoff, latestRun: listTaskAgentRuns(taskId)[0] ?? null };
  }
  return NextResponse.json({ tasks });
}, "tasks.agentRuns.summary.get");
