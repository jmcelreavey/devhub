import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context.ts";
import { historyEnabled, mcpHistoryDir } from "./history.ts";
import { createDevhubMcpServer, startupHousekeeping, TOOLSET_NAMES } from "./server.ts";

/** stdio entry — what synced client configs launch. The HTTP entry is http.ts. */
const ctx = createContext();
startupHousekeeping();
const { server, toolsets } = createDevhubMcpServer(ctx);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `DevHub MCP server running (notes: ${ctx.notesDir}, docs: ${ctx.docsDir}, dashboard: ${ctx.dashboard.baseUrl}, toolsets: ${toolsets.names.length}/${TOOLSET_NAMES.length}, history: ${historyEnabled() ? mcpHistoryDir() : "off"})`,
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
