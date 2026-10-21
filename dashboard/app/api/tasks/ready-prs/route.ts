import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { readyLinkedDraftPrs } from "@/lib/tasks/ready-linked-prs";

export const dynamic = "force-dynamic";

const Schema = z.object({
  taskId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/),
  reason: z.string().trim().min(1).max(200).optional(),
});

/** Mark a task's own open draft PRs ready for review (the completion safety net, on demand). */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const outcomes = await readyLinkedDraftPrs(parsed.data.taskId, parsed.data.reason ?? "task completed");
  return NextResponse.json({ outcomes });
}, "tasks.readyPrs.post");
