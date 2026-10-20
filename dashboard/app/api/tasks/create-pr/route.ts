import { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { TaskIdSchema } from "@/lib/storyboard/schema";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";
import { CreateDraftPrError, createDraftPrForTask } from "@/lib/tasks/create-draft-pr";

export const dynamic = "force-dynamic";
const Schema = z.object({ taskId: TaskIdSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Approve a reviewed task's work and open its draft PR. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  try {
    return storyboardJson(await createDraftPrForTask({ ...parsed.data, origin: req.nextUrl.origin }));
  } catch (error) {
    if (error instanceof CreateDraftPrError) return storyboardJson({ error: error.message }, error.status);
    return storyboardError(error);
  }
}, "tasks.create-pr");
