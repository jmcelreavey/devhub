import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { taskReviewSettingsGet, taskReviewSettingsSet } from "../../../../../../../../packages/shared/actions/task-agent";
import {
  MAX_REVIEW_MODEL_LENGTH,
  readImplementReviewPrefs,
  saveImplementReviewPrefs,
} from "../../../../../domains/tasks/implement-review-prefs";


/**
 * GET/PUT /api/tasks/implement/review-settings: which assistant reviews a
 * finished implementation before it asks to commit. Blank provider means the
 * implementing agent reviews its own diff. Auth: same-origin or DEVHUB_API_SECRET.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(taskReviewSettingsGet, {
    input: () => ({}),
    context: () => ({ read: async () => ({ ok: true, value: readImplementReviewPrefs() }) }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "tasks.implement.reviewSettings.get");

const PutSchema = taskReviewSettingsSet.input
  .extend({
    provider: z
      .string()
      .trim()
      .max(64)
      .regex(/^$|^[a-z0-9][a-z0-9._-]*$/i, "provider must be a provider id like codex")
      .optional(),
    model: z.string().trim().max(MAX_REVIEW_MODEL_LENGTH).optional(),
    effort: z.string().trim().max(32).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,31})?$/).optional(),
  })
  .refine((value) => value.provider !== undefined || value.model !== undefined || value.effort !== undefined, {
    message: "Provide provider, model, effort, or a combination.",
  });

export const PUT = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, PutSchema);
  if (!parsed.ok) return parsed.response;
  return httpAction(taskReviewSettingsSet, {
    input: () => parsed.data,
    context: () => ({ save: async (input) => ({ ok: true, value: await saveImplementReviewPrefs(input) }) }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "tasks.implement.reviewSettings.put");
