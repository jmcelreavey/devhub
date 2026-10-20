import { after, NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { TaskAgentResumeError } from "@/lib/tasks/resume-task-agent";
import { TaskIdSchema } from "@/lib/storyboard/schema";
import { recoverFailure } from "@/lib/storyboard/failure-recovery";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";

export const dynamic = "force-dynamic";
const RecoverySchema = z.object({ taskId: TaskIdSchema, key: z.string().min(1).max(8000), action: z.enum(["clear", "restore", "retry", "resume"]), guidance: z.string().trim().min(1).max(4000).optional() });

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, RecoverySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await recoverFailure(parsed.data, req.nextUrl.origin);
    if (result.execute) after(result.execute);
    return storyboardJson({ ok: true });
  } catch (error) {
    if (error instanceof TaskAgentResumeError) return storyboardJson({ error: error.message }, error.status);
    return storyboardError(error);
  }
}, "tasks.failure");
