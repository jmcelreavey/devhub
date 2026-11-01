import { taskCreatePr } from "../../../../../../../packages/shared/actions/tasks";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";
import { CreateDraftPrError, createDraftPrForTask } from "../../../../domains/tasks/create-draft-pr";


/** Approve a reviewed task's work and open its draft PR. */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskCreatePr.input);
  if (!parsed.ok) return parsed.response;
  return taskCreatePr.handler(parsed.data, { execute: async (input) => {
    try {
      return storyboardJson(await createDraftPrForTask({ ...input, origin: new URL(req.url).origin }));
    } catch (error) {
      if (error instanceof CreateDraftPrError) return storyboardJson({ error: error.message }, error.status);
      return storyboardError(error);
    }
  } });
}, "tasks.create-pr");
