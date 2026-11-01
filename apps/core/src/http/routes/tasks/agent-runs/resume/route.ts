import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { taskAgentResume } from "../../../../../../../../packages/shared/actions/task-agent";
import { isValidTaskAgentTaskId } from "../../../../../domains/tasks/task-agent-runs";
import { resumeTaskAgent, TaskAgentResumeError } from "../../../../../domains/tasks/resume-task-agent";


const ResumeSchema = taskAgentResume.input.extend({
  origin: z.string().url().max(500).optional(),
  effort: z.string().trim().max(32).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,31})?$/).optional(),
  repoName: z.string().trim().min(1).max(300).optional(),
});

/** Resume a task: follow-up preferred, else new agent run quoting handoff. */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ResumeSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!isValidTaskAgentTaskId(body.taskId)) {
    return Response.json({ error: "invalid taskId" }, { status: 400 });
  }
  const origin =
    body.origin?.replace(/\/$/, "") ||
    req.headers.get("origin")?.replace(/\/$/, "") ||
    `http://127.0.0.1:${process.env.PORT || "1337"}`;
  return httpAction(taskAgentResume, {
    input: () => body,
    context: () => ({ resume: async (input) => {
      try {
        return { ok: true, value: await resumeTaskAgent({ ...input, repoName: body.repoName, origin }) };
      } catch (error) {
        if (error instanceof TaskAgentResumeError) return { ok: false, error: error.message, status: error.status };
        throw error;
      }
    } }),
    response: (result) => result.ok ? Response.json(result.value, { status: 201 }) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "tasks.agentRuns.resume");
