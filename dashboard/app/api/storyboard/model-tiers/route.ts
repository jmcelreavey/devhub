import { NextRequest, NextResponse } from "next/server";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { ModelTierSettingsSchema, readModelTiers, writeModelTiers } from "@/lib/storyboard/model-tiers";

export const dynamic = "force-dynamic";

/** Saved cheap/mid/heavy defaults used when a task starts Implement on auto. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: readModelTiers() });
}, "storyboard.modelTiers.get");

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ModelTierSettingsSchema);
  if (!parsed.ok) return parsed.response;
  return NextResponse.json({ settings: writeModelTiers(parsed.data) });
}, "storyboard.modelTiers.put");
