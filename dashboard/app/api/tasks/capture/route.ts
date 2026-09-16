import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { EntityRefSchema } from "@/lib/schemas";
import { captureDraftTask } from "@/lib/tasks/capture";

export const dynamic = "force-dynamic";

const CaptureSchema = z.object({
  text: z.string().trim().min(1).max(500),
  detail: z.string().max(10_000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  links: z.array(EntityRefSchema).max(20).optional(),
});

/** Save an idea as a draft task with a context snapshot in its note. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, CaptureSchema);
  if (!parsed.ok) return parsed.response;
  const result = await captureDraftTask(parsed.data);
  return NextResponse.json(result, { status: 201 });
}, "tasks.capture.post");
