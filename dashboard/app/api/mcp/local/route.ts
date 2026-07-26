import { NextResponse } from "next/server";
import { getResourceRoot } from "@/lib/desktop/runtime-paths";
import { scanLocalMcpImportCandidates } from "@/lib/collect/mcp";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/** MCP servers found in each tool's config (for selective reverse-sync UI). */
export const GET = withErrorHandler(async () => {
  const candidates = scanLocalMcpImportCandidates(getResourceRoot());
  return NextResponse.json({ candidates });
}, "mcp.local");
