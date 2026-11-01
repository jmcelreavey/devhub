import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { taskCapture, taskCaptureInput } from "../../../../../../../packages/shared/actions/plans";
import { EntityRefSchema } from "../../../../lib/schemas";
import { captureDraftTask } from "../../../../domains/tasks/capture";
import { resolveActiveProfileId } from "../../../../../../../packages/shared/vault/task-profiles.ts";
import { getTasksDir } from "../../../../lib/notes/dir";


const CaptureSchema = taskCaptureInput.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  links: z.array(EntityRefSchema).max(20).optional(),
  profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).optional(),
});

/** Save an idea as a draft task with a context snapshot in its note. */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, CaptureSchema);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.profile && parsed.data.profile !== (resolveActiveProfileId(getTasksDir()) ?? "legacy")) {
    return Response.json({ error: "The active profile changed. Refresh before saving this idea." }, { status: 409 });
  }
  return httpAction(taskCapture, {
    input: () => parsed.data,
    context: () => ({ capture: () => captureDraftTask(parsed.data) }),
    response: (result) => Response.json(result, { status: 201 }),
  })(req);
}, "tasks.capture.post");
