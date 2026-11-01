import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { StoryboardError } from "../../../../../lib/storyboard/errors";
import { addTaskUserNote, taskNoteCapability } from "../../../../../domains/tasks/add-user-note-server";
import { TaskNoteNotFoundError, TaskNoteOpError } from "../../../../../domains/tasks/task-note-sections";
import { taskNoteAdd, taskNoteCapabilityRead } from "../../../../../../../../packages/shared/actions/task-note";
import { httpAction } from "../../../../../lib/actions/http";

const Schema = taskNoteAdd.input.omit({ id: true }).extend({
  taskId: z.string().trim().min(1).max(128),
});

async function respond(work: () => Promise<unknown>) {
  try { return Response.json(await work()); }
  catch (error) {
    if (error instanceof StoryboardError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof TaskNoteNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof TaskNoteOpError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export const GET = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!taskId || taskId.length > 128) return Response.json({ error: "taskId is required" }, { status: 400 });
  return respond(() => Promise.resolve(taskNoteCapabilityRead.handler({ taskId }, { read: taskNoteCapability })));
}, "tasks.note.add.get");

export const POST = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(request, Schema);
  if (!parsed.ok) return parsed.response;
  return httpAction(taskNoteAdd, {
    input: () => ({ ...parsed.data, id: parsed.data.taskId }),
    context: () => ({
      add: ({ id, ...input }) => addTaskUserNote({ ...input, taskId: id }, new URL(request.url).origin),
      classifyError: (error) => {
        if (error instanceof StoryboardError) return { error: error.message, status: error.status };
        if (error instanceof TaskNoteNotFoundError) return { error: error.message, status: 404 };
        if (error instanceof TaskNoteOpError) return { error: error.message, status: 400 };
        return null;
      },
    }),
    response: (result) => result.ok
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: result.status }),
  })(request);
}, "tasks.note.add.post");
