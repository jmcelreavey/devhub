import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isValidTaskAgentTaskId } from "@/lib/tasks/task-agent-runs";
import { planTaskAgent, TaskAgentPlanError } from "@/lib/tasks/plan-task-agent";

export const dynamic = "force-dynamic";

const PlanSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origin: z.string().url().max(500).optional(),
  provider: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().max(120).optional(),
  effort: z.string().trim().max(32).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,31})?$/).optional(),
  cwd: z.string().trim().min(1).max(1_000).optional(),
  repoName: z.string().trim().min(1).max(300).optional(),
  /** The calling agent's nesting level, forwarded by the MCP server as a recursion guard. */
  depth: z.number().int().min(0).max(20).default(0),
});

/** Start a plan-only agent run for a task: it writes the plan into the note and stops. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, PlanSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!isValidTaskAgentTaskId(body.taskId)) return NextResponse.json({ error: "invalid taskId" }, { status: 400 });
  const origin = body.origin?.replace(/\/$/, "") || req.headers.get("origin")?.replace(/\/$/, "") || `http://127.0.0.1:${process.env.PORT || "1337"}`;
  try {
    return NextResponse.json(await planTaskAgent({ ...body, origin }), { status: 201 });
  } catch (err) {
    if (err instanceof TaskAgentPlanError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, "tasks.agentRuns.plan");
