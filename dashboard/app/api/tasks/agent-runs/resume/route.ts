import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isValidTaskAgentTaskId } from "@/lib/tasks/task-agent-runs";
import { resumeTaskAgent, TaskAgentResumeError } from "@/lib/tasks/resume-task-agent";

export const dynamic = "force-dynamic";

const ResumeSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origin: z.string().url().max(500).optional(),
  provider: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().max(120).optional(),
  cwd: z.string().trim().min(1).max(1_000).optional(),
  repoName: z.string().trim().min(1).max(300).optional(),
});

/** Resume a task: follow-up preferred, else new agent run quoting handoff. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ResumeSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!isValidTaskAgentTaskId(body.taskId)) {
    return NextResponse.json({ error: "invalid taskId" }, { status: 400 });
  }
  const origin =
    body.origin?.replace(/\/$/, "") ||
    req.headers.get("origin")?.replace(/\/$/, "") ||
    `http://127.0.0.1:${process.env.PORT || "1337"}`;
  try {
    const result = await resumeTaskAgent({ ...body, origin });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof TaskAgentResumeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}, "tasks.agentRuns.resume");
