import { runBackground } from "@devhub/core/http/background";
import { taskFailureRecovery } from "../../../../../../../packages/shared/actions/tasks";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { TaskAgentResumeError } from "../../../../domains/tasks/resume-task-agent";
import { recoverFailure } from "../../../../lib/storyboard/failure-recovery";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";


export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskFailureRecovery.input);
  if (!parsed.ok) return parsed.response;
  return taskFailureRecovery.handler(parsed.data, { execute: async (input) => {
    try {
      const result = await recoverFailure(input, new URL(req.url).origin);
      if (result.execute) runBackground("tasks/failure", result.execute);
      return storyboardJson({ ok: true });
    } catch (error) {
      if (error instanceof TaskAgentResumeError) return storyboardJson({ error: error.message }, error.status);
      return storyboardError(error);
    }
  } });
}, "tasks.failure");
