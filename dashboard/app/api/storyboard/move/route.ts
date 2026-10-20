import { NextRequest } from "next/server";
import { z } from "zod";
import { TASK_NOTE_STATUSES } from "@shared/task-note/meta.ts";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { moveTaskCard } from "@/lib/storyboard/manual-move";
import { TaskIdSchema } from "@/lib/storyboard/schema";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";

export const dynamic = "force-dynamic";
const MoveSchema = z.object({ taskId: TaskIdSchema, status: z.enum(TASK_NOTE_STATUSES), stopActive: z.boolean().optional() });

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, MoveSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await moveTaskCard(parsed.data);
    return storyboardJson(result, result.ok ? 200 : 409);
  } catch (error) { return storyboardError(error); }
}, "storyboard.move");
