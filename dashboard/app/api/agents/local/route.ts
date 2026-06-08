import { NextResponse } from "next/server";
import { getRepoRoot } from "@/lib/notes-dir";
import { scanLocalAgentImportCandidates } from "@/lib/collect-agents";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  const candidates = scanLocalAgentImportCandidates(getRepoRoot());
  return NextResponse.json({ candidates });
}, "agents.local");
