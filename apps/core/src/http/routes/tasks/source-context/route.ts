import { taskSourceContextRead, taskSourceContextWrite } from "../../../../../../../packages/shared/actions/tasks";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { acknowledgeSourceContext, readSourceContext, refreshSourceContext, SourceContextConflict } from "../../../../domains/tasks/source-context";
import { activeTaskProfile, requestedTaskProfile, taskProfileConflict, withTaskProfileRequest } from "../../../../domains/tasks/profile-request";


export const GET = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const profile = requestedTaskProfile(request) ?? activeTaskProfile();
  const conflict = taskProfileConflict(profile);
  if (conflict) return conflict;
  const input = taskSourceContextRead.input.safeParse({ taskId: new URL(request.url).searchParams.get("taskId") });
  if (!input.success) return Response.json({ error: "Valid taskId required." }, { status: 400 });
  return taskSourceContextRead.handler(input.data, { execute: async ({ taskId }) =>
    withTaskProfileRequest(profile, () => Response.json(readSourceContext(taskId), { headers: { "Cache-Control": "no-store" } })),
  });
}, "tasks.source-context");

export const POST = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const profile = requestedTaskProfile(request) ?? activeTaskProfile();
  const conflict = taskProfileConflict(profile);
  if (conflict) return conflict;
  const body = await parseBody(request, taskSourceContextWrite.input);
  if (!body.ok) return body.response;
  return taskSourceContextWrite.handler(body.data, { execute: async (value) => withTaskProfileRequest(profile, async () => {
    try {
      const result = value.action === "refresh"
        ? await refreshSourceContext(value.taskId, value.revision)
        : value.revision && value.briefRevision
          ? await acknowledgeSourceContext(value.taskId, value.revision, value.briefRevision)
          : null;
      if (!result) return Response.json({ error: "Source and brief revisions are required." }, { status: 400 });
      return Response.json(result);
    } catch (error) {
      if (error instanceof SourceContextConflict) return Response.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }) });
}, "tasks.source-context-update");
