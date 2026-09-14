import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  isHistoryDate,
  localDate,
  mcpHistoryDir,
  readMcpHistory,
  summarizeMcpHistory,
} from "@shared/mcp-history/index.ts";

export const dynamic = "force-dynamic";

/**
 * One day of DevHub MCP calls: newest-first entries plus a summary of the
 * filtered set. Filters mirror the `mcp_history` MCP tool.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const search = req.nextUrl.searchParams;
  const date = search.get("date") || localDate(Date.now());
  if (!isHistoryDate(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const rawLimit = Number(search.get("limit") ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 1_000) : 200;

  const entries = readMcpHistory(mcpHistoryDir(), date, {
    tool: search.get("tool") || undefined,
    errorsOnly: search.get("errorsOnly") === "1",
    client: search.get("client") || undefined,
    agentRunId: search.get("agentRunId") || undefined,
  });
  return NextResponse.json({
    date,
    total: entries.length,
    summary: summarizeMcpHistory(date, entries),
    entries: entries.slice(-limit).reverse(),
  });
}, "mcp-history.get");
