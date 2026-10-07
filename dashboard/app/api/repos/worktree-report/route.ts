import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { readWorktreeReport } from "@/lib/repos/worktree-report";
export const dynamic = "force-dynamic";
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ report: readWorktreeReport() });
}, "worktrees.report");
