import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isValidTaskAgentRunId, isValidTaskAgentTaskId } from "@/lib/tasks/task-agent-runs";
import { handleTaskPrAttention } from "@/lib/tasks/task-pr-watch";

export const dynamic = "force-dynamic";

const Schema = z.object({
  taskId: z.string().trim().min(1).max(128),
  runId: z.string().trim().min(1).max(64),
});

/**
 * Mark a run's PR attention handled — dismissed, or the agent was sent back to
 * fix it. It stays quiet until the PR head or the finding changes.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const { taskId, runId } = parsed.data;
  if (!isValidTaskAgentTaskId(taskId) || !isValidTaskAgentRunId(runId)) {
    return NextResponse.json({ error: "invalid taskId or runId" }, { status: 400 });
  }
  const run = await handleTaskPrAttention(taskId, runId);
  if (!run) return NextResponse.json({ error: "run not linked to task" }, { status: 404 });
  return NextResponse.json({ run });
}, "tasks.agentRuns.attention.post");
