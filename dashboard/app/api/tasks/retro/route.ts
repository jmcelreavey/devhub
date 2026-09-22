import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { buildRetroInputs } from "@/lib/tasks/retro-inputs";

export const dynamic = "force-dynamic";

/** Inputs for the plan retro: finished/abandoned tasks, run outcomes, MCP failures, skills. `?days=7` (1–31). */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const days = Number.parseInt(req.nextUrl.searchParams.get("days") ?? "7", 10);
  return NextResponse.json(await buildRetroInputs(Number.isFinite(days) ? days : 7));
}, "tasks.retro.get");
