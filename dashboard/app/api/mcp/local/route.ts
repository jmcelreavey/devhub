import { NextResponse } from "next/server";
import { getRepoRoot } from "@/lib/notes-dir";
import { scanLocalMcpImportCandidates } from "@/lib/collect-mcp";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/** MCP servers found in each tool's config (for selective reverse-sync UI). */
export const GET = withErrorHandler(async () => {
  const candidates = scanLocalMcpImportCandidates(getRepoRoot());
  return NextResponse.json({ candidates });
}, "mcp.local");
