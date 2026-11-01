import { mcpLocalCandidates } from "../../../../../../../packages/shared/actions/assets";
import { getResourceRoot } from "../../../../lib/desktop/runtime-paths";
import { scanLocalMcpImportCandidates } from "../../../../lib/collect/mcp";
import { withErrorHandler } from "../../../../lib/api-utils";


/** MCP servers found in each tool's config (for selective reverse-sync UI). */
export const GET = withErrorHandler(async () => {
  return await mcpLocalCandidates.handler({}, { execute: async () => {
    const candidates = scanLocalMcpImportCandidates(getResourceRoot());
    return Response.json({ candidates });
  } }) as Response;
}, "mcp.local");
