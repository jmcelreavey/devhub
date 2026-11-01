import { notifyTaskQuestionResolved } from "../../../../../lib/plugin-integration-hooks";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { getStorage } from "../../../../../lib/storage-server";
import { normalizeTaskNotePath } from "../../../../../../../../packages/shared/task-note/update.ts";
import { taskNoteRead, taskNoteUpdate, type TaskNoteContext, type TaskNoteOutcome } from "../../../../../../../../packages/shared/actions/task-note";
import { httpAction } from "../../../../../lib/actions/http";
import {
  TaskNoteNotFoundError,
  TaskNoteOpError,
  updateTaskNoteSections,
} from "../../../../../domains/tasks/task-note-sections";


/**
 * Target envelope. The operation fields (`op`, `text`, `title`, …) ride alongside and are
 * validated by the shared `parseTaskNoteOp`, the same code the MCP tool runs.
 */
const TargetSchema = taskNoteUpdate.input
  .pick({ notePath: true, taskId: true, date: true })
  .extend({
    notePath: z.string().trim().min(1).max(300).optional(),
    taskId: z.string().trim().min(1).max(128).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .passthrough();

const taskNoteContext: TaskNoteContext = {
  update: updateTaskNoteSections,
  classifyError: (error) => error instanceof TaskNoteOpError
    ? { error: error.message, notFound: error instanceof TaskNoteNotFoundError }
    : null,
};

function noteResponse(result: TaskNoteOutcome) {
  return result.ok
    ? Response.json(result.value)
    : Response.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
}

/**
 * Read a task note as sections (item ids included) without writing it.
 * `probe=1` returns only `{ modified }` so an open note can poll cheaply for agent edits.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  if (params.get("probe") === "1") {
    const probePath = params.get("notePath");
    if (!probePath) return Response.json({ error: "notePath is required" }, { status: 400 });
    try {
      const notePath = normalizeTaskNotePath(probePath);
      const file = getStorage().read(notePath);
      if (!file) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ modified: file.modified });
    } catch (error) {
      if (error instanceof TaskNoteOpError) return Response.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  const target = TargetSchema.safeParse({
    notePath: params.get("notePath") ?? undefined,
    taskId: params.get("taskId") ?? undefined,
    date: params.get("date") ?? undefined,
  });
  if (!target.success) return Response.json({ error: "Invalid notePath, taskId or date" }, { status: 400 });
  return httpAction(taskNoteRead, {
    input: () => target.data,
    context: () => taskNoteContext,
    response: noteResponse,
  })(req);
}, "tasks.note.sections.get");

/**
 * Apply one section operation: set_summary, set_status, add_question, resolve_question,
 * add_decision, add_media, add_bug, set_bug_status, add_waypoint, add_poi, append_log,
 * set_meta, remove_item, clear_section. Free-form sections are never touched.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, TargetSchema);
  if (!parsed.ok) return parsed.response;
  const response = await httpAction(taskNoteUpdate, {
    input: () => parsed.data,
    context: () => taskNoteContext,
    response: noteResponse,
  })(req);
  // An answer clears a Needs-you card in Slack: let it notice now rather than on the next 20s tick.
  if (response.ok && parsed.data.op === "resolve_question") notifyTaskQuestionResolved();
  return response;
}, "tasks.note.sections.post");
