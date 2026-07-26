import { NextResponse } from "next/server";
import { getResourceRoot } from "@/lib/desktop/runtime-paths";
import { scanLocalAgentImportCandidates } from "@/lib/collect/agents";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  const candidates = scanLocalAgentImportCandidates(getResourceRoot());
  return NextResponse.json({ candidates });
}, "agents.local");
