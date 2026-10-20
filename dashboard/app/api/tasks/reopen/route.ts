import { after, NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { reopenWithFeedback } from "@/lib/tasks/reopen-feedback";
import { TaskAgentResumeError } from "@/lib/tasks/resume-task-agent";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";

export const dynamic = "force-dynamic";
const ReopenSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().max(400).optional(),
  addressFeedback: z.boolean().optional(),
  followUp: z.boolean().optional(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ReopenSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { id, ...fields } = parsed.data;
    const result = await reopenWithFeedback({ ...fields, taskId: id }, req.nextUrl.origin);
    const { execute, ...body } = result;
    if (execute) after(execute);
    return storyboardJson(body);
  } catch (error) {
    if (error instanceof TaskAgentResumeError) return storyboardJson({ error: error.message }, error.status);
    return storyboardError(error);
  }
}, "tasks.reopen");
