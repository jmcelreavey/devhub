import { runBackground } from "@devhub/core/http/background";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { reopenWithFeedback } from "../../../../domains/tasks/reopen-feedback";
import { TaskAgentResumeError } from "../../../../domains/tasks/resume-task-agent";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";
import { taskReopen } from "../../../../../../../packages/shared/actions/tasks";
import { httpAction } from "../../../../lib/actions/http";

const ReopenSchema = taskReopen.input.extend({
  followUp: z.boolean().optional(),
});

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ReopenSchema);
  if (!parsed.ok) return parsed.response;
  return httpAction(taskReopen, {
    input: () => parsed.data,
    context: () => ({
      reopen: async ({ id, ...fields }) => {
        try {
          const result = await reopenWithFeedback({ ...fields, followUp: parsed.data.followUp, taskId: id }, new URL(req.url).origin);
          const { execute, ...body } = result;
          if (execute) runBackground("tasks/reopen", execute);
          return { ok: true as const, value: body };
        } catch (error) {
          const response = error instanceof TaskAgentResumeError ? storyboardJson({ error: error.message }, error.status) : storyboardError(error);
          const body = await response.json() as { error: string };
          return { ok: false as const, error: body.error, status: response.status, body };
        }
      },
    }),
    response: (result) => result.ok ? storyboardJson(result.value) : storyboardJson(result.body ?? { error: result.error }, result.status),
  })(req);
}, "tasks.reopen");
