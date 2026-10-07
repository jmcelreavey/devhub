import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { loadAgentUsage } from "@/lib/agent-usage";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ providers: await loadAgentUsage(req.nextUrl.searchParams.get("refresh") ?? undefined) }, { headers: { "Cache-Control": "no-store" } });
}, "agent-usage");
