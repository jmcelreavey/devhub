import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  getTaskAgentHandoff,
  isValidTaskAgentTaskId,
  setTaskAgentHandoff,
} from "@/lib/tasks/task-agent-runs";

export const dynamic = "force-dynamic";

/** Read durable handoff markdown for a task (resume reads this first). */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const taskId = new URL(req.url).searchParams.get("taskId")?.trim() ?? "";
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  if (!isValidTaskAgentTaskId(taskId)) {
    return NextResponse.json({ error: "invalid taskId" }, { status: 400 });
  }
  const view = getTaskAgentHandoff(taskId);
  return NextResponse.json(view);
}, "tasks.agentHandoff.get");

const SetSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  handoff: z.string().max(100_000),
  mode: z.enum(["replace", "append"]).optional(),
});

/** Write/replace or append handoff before pause / EOD / abandon. */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, SetSchema);
  if (!parsed.ok) return parsed.response;
  if (!isValidTaskAgentTaskId(parsed.data.taskId)) {
    return NextResponse.json({ error: "invalid taskId" }, { status: 400 });
  }
  try {
    await setTaskAgentHandoff(parsed.data.taskId, parsed.data.handoff, { mode: parsed.data.mode });
    return NextResponse.json(getTaskAgentHandoff(parsed.data.taskId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "handoff update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}, "tasks.agentHandoff.put");
