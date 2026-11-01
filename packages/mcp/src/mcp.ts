import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exitWithParent } from "../../../packages/shared/process/exit-with-parent.ts";
import { createContext } from "./context.ts";
import { historyEnabled, mcpHistoryDir } from "./history.ts";
import { createConfiguredDevhubMcpServer, startupHousekeeping } from "./server.ts";

/** stdio entry — what synced client configs launch. The HTTP entry is http.ts. */
async function main() {
  const ctx = createContext();
  const { server, toolsets, availableToolsets } = await createConfiguredDevhubMcpServer(ctx);
  startupHousekeeping(process.env, availableToolsets);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // A client that dies without closing the pipe must not leave this server behind.
  exitWithParent();
  console.error(
    `DevHub MCP server running (notes: ${ctx.notesDir}, docs: ${ctx.docsDir}, dashboard: ${ctx.dashboard.baseUrl}, toolsets: ${toolsets.names.length}/${availableToolsets.length}, history: ${historyEnabled() ? mcpHistoryDir() : "off"})`,
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
