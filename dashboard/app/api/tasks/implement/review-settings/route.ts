import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  MAX_REVIEW_MODEL_LENGTH,
  readImplementReviewPrefs,
  saveImplementReviewPrefs,
} from "@/lib/tasks/implement-review-prefs";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/tasks/implement/review-settings: which assistant reviews a
 * finished implementation before it asks to commit. Blank provider means the
 * implementing agent reviews its own diff. Auth: same-origin or DEVHUB_API_SECRET.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(readImplementReviewPrefs());
}, "tasks.implement.reviewSettings.get");

const PutSchema = z
  .object({
    provider: z
      .string()
      .trim()
      .max(64)
      .regex(/^$|^[a-z0-9][a-z0-9._-]*$/i, "provider must be a provider id like codex")
      .optional(),
    model: z.string().trim().max(MAX_REVIEW_MODEL_LENGTH).optional(),
  })
  .refine((value) => value.provider !== undefined || value.model !== undefined, {
    message: "Provide provider, model or both.",
  });

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, PutSchema);
  if (!parsed.ok) return parsed.response;
  return NextResponse.json(await saveImplementReviewPrefs(parsed.data));
}, "tasks.implement.reviewSettings.put");
