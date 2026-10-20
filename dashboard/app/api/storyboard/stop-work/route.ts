import { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { TaskIdSchema } from "@/lib/storyboard/schema";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";
import { stopTaskWork } from "@/lib/storyboard/stop-task-work";
import { resolveReopenTask } from "@/lib/tasks/reopen-task";

export const dynamic = "force-dynamic";
const StopSchema = z.object({ taskId: TaskIdSchema });

/** Pause auto and stop the task's live runs, keeping its worktree, note and history. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, StopSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const task = await resolveReopenTask(parsed.data.taskId);
    await stopTaskWork(task.id);
    return storyboardJson({ ok: true });
  } catch (error) { return storyboardError(error); }
}, "storyboard.stop-work");
