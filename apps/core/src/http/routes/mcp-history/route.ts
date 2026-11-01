import { requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { httpAction } from "../../../lib/actions/http";
import { mcpHistory } from "../../../../../../packages/shared/actions/history";
import {
  isHistoryDate,
  localDate,
  mcpHistoryDir,
  readMcpHistory,
  summarizeMcpHistory,
  type McpHistoryEntry,
} from "../../../../../../packages/shared/mcp-history/index.ts";


/**
 * One day of DevHub MCP calls: newest-first entries plus a summary of the
 * filtered set. Filters mirror the `mcp_history` MCP tool.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const search = new URL(req.url).searchParams;
  const date = search.get("date") || localDate(Date.now());
  if (!isHistoryDate(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const rawLimit = Number(search.get("limit") ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 1_000) : 200;

  return httpAction(mcpHistory, {
    input: () => ({ date, tool: search.get("tool") || undefined, errorsOnly: search.get("errorsOnly") === "1", client: search.get("client") || undefined, agentRunId: search.get("agentRunId") || undefined }),
    context: () => ({
      today: () => localDate(Date.now()),
      read: (day, filters) => readMcpHistory(mcpHistoryDir(), day, filters),
      summarize: (day, entries) => summarizeMcpHistory(day, entries as McpHistoryEntry[]),
      limit,
    }),
    response: (result) => Response.json(result),
  })(req);
}, "mcp-history.get");
