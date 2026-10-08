import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { readTodayViewPref, writeTodayViewPref } from "@/lib/today/view-pref";

export const dynamic = "force-dynamic";

/** GET/PUT /api/ui-prefs/today-view: the Today view (Focus or Dashboard), shared by every origin on this machine. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ view: readTodayViewPref() }, { headers: { "Cache-Control": "no-store" } });
}, "ui-prefs.today-view.get");

const PutSchema = z.object({ view: z.enum(["focus", "dashboard"]) });

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, PutSchema);
  if (!parsed.ok) return parsed.response;
  await writeTodayViewPref(parsed.data.view);
  return NextResponse.json({ view: parsed.data.view });
}, "ui-prefs.today-view.put");
