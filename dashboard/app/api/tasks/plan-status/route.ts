import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { buildPlanStatus, formatPlanStatus } from "@/lib/tasks/plan-status";

export const dynamic = "force-dynamic";

/** Open tasks grouped by where they are in the plan loop. `?format=text` for a plain report. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const date = req.nextUrl.searchParams.get("date")?.trim() || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const status = buildPlanStatus(date);
  if (req.nextUrl.searchParams.get("format") === "text") {
    return NextResponse.json({ text: formatPlanStatus(status) });
  }
  return NextResponse.json(status);
}, "tasks.planStatus.get");
