import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { StoryboardError } from "@/lib/storyboard/errors";
import { addTaskUserNote, taskNoteCapability } from "@/lib/tasks/add-user-note-server";
import { TaskNoteNotFoundError, TaskNoteOpError } from "@/lib/tasks/task-note-sections";

export const dynamic = "force-dynamic";
const Schema = z.object({
  taskId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(4000),
  updateAgent: z.boolean().optional(),
  noteId: z.string().min(1).max(128).optional(),
  confirmStop: z.boolean().optional(),
});

async function respond(work: () => Promise<unknown>) {
  try { return NextResponse.json(await work()); }
  catch (error) {
    if (error instanceof StoryboardError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TaskNoteNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof TaskNoteOpError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const taskId = request.nextUrl.searchParams.get("taskId");
  if (!taskId || taskId.length > 128) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  return respond(() => taskNoteCapability(taskId));
}, "tasks.note.add.get");

export const POST = withErrorHandler(async (request: NextRequest) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(request, Schema);
  if (!parsed.ok) return parsed.response;
  return respond(() => addTaskUserNote(parsed.data, request.nextUrl.origin));
}, "tasks.note.add.post");
