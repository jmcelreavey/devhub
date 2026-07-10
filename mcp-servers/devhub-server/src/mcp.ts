import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context.ts";
import { registerNotesTools } from "./tools/notes.ts";
import { registerDocsTools } from "./tools/docs.ts";
import { registerTasksTools } from "./tools/tasks.ts";
import { registerDiagramsTools } from "./tools/diagrams.ts";
import { registerAppraisalTools } from "./tools/appraisal.ts";
import { registerStatusTools } from "./tools/status.ts";
import { registerBriefingTools } from "./tools/briefing.ts";
import { registerCalendarTools } from "./tools/calendar.ts";
import { registerWorkTools } from "./tools/work.ts";
import { registerAssetsTools } from "./tools/assets.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerScriptsTools } from "./tools/scripts.ts";
import { registerReposTools } from "./tools/repos.ts";
import { registerDatadogTools } from "./tools/datadog.ts";
import { registerSessionTools } from "./tools/sessions.ts";

const server = new McpServer({
  name: "devhub",
  version: "4.0.0",
});

const ctx = createContext();

// Filesystem-backed tools (work headless, no dashboard required).
registerNotesTools(server, ctx);
registerDocsTools(server, ctx);
registerTasksTools(server, ctx);
registerDiagramsTools(server, ctx);
registerAppraisalTools(server, ctx);

// Dashboard-backed tools (proxy localhost:1337; need the dashboard running).
registerStatusTools(server, ctx);
registerBriefingTools(server, ctx);
registerCalendarTools(server, ctx);
registerWorkTools(server, ctx);
registerAssetsTools(server, ctx);
registerSearchTools(server, ctx);
registerScriptsTools(server, ctx);
registerReposTools(server, ctx);
registerDatadogTools(server, ctx);
registerSessionTools(server, ctx);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `DevHub MCP server running (notes: ${ctx.notesDir}, docs: ${ctx.docsDir}, dashboard: ${ctx.dashboard.baseUrl})`,
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
