import { pokeSlackNeedsYou } from "@/lib/integrations/slack/runtime";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { getStorage } from "@/lib/storage-server";
import { normalizeTaskNotePath } from "@shared/task-note/update.ts";
import {
  TaskNoteNotFoundError,
  TaskNoteOpError,
  updateTaskNoteSections,
  type TaskNoteTarget,
} from "@/lib/tasks/task-note-sections";

export const dynamic = "force-dynamic";

/**
 * Target envelope. The operation fields (`op`, `text`, `title`, …) ride alongside and are
 * validated by the shared `parseTaskNoteOp`, the same code the MCP tool runs.
 */
const TargetSchema = z
  .object({
    notePath: z.string().trim().min(1).max(300).optional(),
    taskId: z.string().trim().min(1).max(128).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .passthrough();

function run(target: TaskNoteTarget, fields: Record<string, unknown>) {
  try {
    return NextResponse.json(updateTaskNoteSections(target, fields));
  } catch (error) {
    if (error instanceof TaskNoteNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof TaskNoteOpError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/**
 * Read a task note as sections (item ids included) without writing it.
 * `probe=1` returns only `{ modified }` so an open note can poll cheaply for agent edits.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const params = new URL(req.url).searchParams;
  if (params.get("probe") === "1") {
    const probePath = params.get("notePath");
    if (!probePath) return NextResponse.json({ error: "notePath is required" }, { status: 400 });
    try {
      const notePath = normalizeTaskNotePath(probePath);
      const file = getStorage().read(notePath);
      if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ modified: file.modified });
    } catch (error) {
      if (error instanceof TaskNoteOpError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  const target = TargetSchema.safeParse({
    notePath: params.get("notePath") ?? undefined,
    taskId: params.get("taskId") ?? undefined,
    date: params.get("date") ?? undefined,
  });
  if (!target.success) return NextResponse.json({ error: "Invalid notePath, taskId or date" }, { status: 400 });
  return run(target.data, { op: "read" });
}, "tasks.note.sections.get");

/**
 * Apply one section operation: set_summary, set_status, add_question, resolve_question,
 * add_decision, add_media, add_bug, set_bug_status, add_waypoint, add_poi, append_log,
 * set_meta, remove_item, clear_section. Free-form sections are never touched.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, TargetSchema);
  if (!parsed.ok) return parsed.response;
  const { notePath, taskId, date, ...fields } = parsed.data;
  const response = await run({ notePath, taskId, date }, fields);
  // An answer clears a Needs-you card in Slack: let it notice now rather than on the next 20s tick.
  if (response.ok && fields.op === "resolve_question") pokeSlackNeedsYou();
  return response;
}, "tasks.note.sections.post");
