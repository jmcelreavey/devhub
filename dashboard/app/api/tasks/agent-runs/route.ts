import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  isTaskAgentRunStatus,
  isValidTaskAgentRunId,
  isValidTaskAgentTaskId,
  listTaskAgentRuns,
  upsertTaskAgentRun,
  TASK_AGENT_RUN_STATUSES,
} from "@/lib/tasks/task-agent-runs";
import { reconcileTaskAgentRunSidecar } from "@/lib/tasks/reconcile-task-agent-sidecar";

export const dynamic = "force-dynamic";

/** List agent runs + handoff linked to a task. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const taskId = new URL(req.url).searchParams.get("taskId")?.trim() ?? "";
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  if (!isValidTaskAgentTaskId(taskId)) {
    return NextResponse.json({ error: "invalid taskId" }, { status: 400 });
  }
  const file = await reconcileTaskAgentRunSidecar(taskId);
  return NextResponse.json({
    taskId,
    handoff: file.handoff,
    handoffUpdatedAt: file.handoffUpdatedAt ?? null,
    runs: listTaskAgentRuns(taskId),
  });
}, "tasks.agentRuns.get");

const UpsertSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  runId: z.string().trim().min(1).max(64),
  status: z.enum(TASK_AGENT_RUN_STATUSES).optional(),
  provider: z.string().trim().min(1).max(64).optional(),
  prUrl: z.string().trim().url().max(2_000).nullable().optional(),
  branch: z.string().trim().min(1).max(300).nullable().optional(),
  sessionId: z.string().trim().min(1).max(200).nullable().optional(),
  terminalSessionId: z.string().trim().min(1).max(200).nullable().optional(),
  startedAt: z.string().datetime().optional(),
  handoff: z.string().max(100_000).optional(),
  handoffMode: z.enum(["replace", "append"]).optional(),
});

/** Link or update a task ↔ agent-run record (optional handoff in the same write). */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, UpsertSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!isValidTaskAgentTaskId(body.taskId)) {
    return NextResponse.json({ error: "invalid taskId" }, { status: 400 });
  }
  if (!isValidTaskAgentRunId(body.runId)) {
    return NextResponse.json({ error: "invalid runId" }, { status: 400 });
  }
  if (body.status && !isTaskAgentRunStatus(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  try {
    const file = await upsertTaskAgentRun(body);
    return NextResponse.json({
      taskId: file.taskId,
      handoff: file.handoff,
      handoffUpdatedAt: file.handoffUpdatedAt ?? null,
      runs: listTaskAgentRuns(file.taskId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upsert failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}, "tasks.agentRuns.post");
