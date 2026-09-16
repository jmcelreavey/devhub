import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { watchTaskPrs } from "@/lib/tasks/task-pr-watch";

export const dynamic = "force-dynamic";

/** Check every task-linked agent PR now instead of waiting for the next poll. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await watchTaskPrs());
}, "tasks.prWatch.post");
