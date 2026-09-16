import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { readAlertDraftsEnabled, setAlertDraftsEnabled } from "@/lib/tasks/alert-drafts";

export const dynamic = "force-dynamic";

/** Whether new on-call alerts become draft tasks. Off by default. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ enabled: readAlertDraftsEnabled() });
}, "tasks.alertDrafts.get");

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, z.object({ enabled: z.boolean() }));
  if (!parsed.ok) return parsed.response;
  return NextResponse.json({ enabled: await setAlertDraftsEnabled(parsed.data.enabled) });
}, "tasks.alertDrafts.put");
