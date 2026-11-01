import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { statusServices, statusExec, statusGit, statusMcp, statusLogs, type StatusMcpResult } from "../../../../packages/shared/actions/status.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";
// Runtime-only references (inside handlers), so the server.ts ↔ status.ts
// import cycle never dereferences a partially-evaluated module.
import { SERVER_VERSION, TOOLSET_NAMES } from "../server.ts";
import { selectToolsets, type ToolsetEnvironment } from "../toolsets.ts";

export function registerStatusTools(server: McpServer, ctx: Context, availableToolsets: readonly string[] = TOOLSET_NAMES, env: ToolsetEnvironment = { DEVHUB_MCP_TOOLSETS: process.env.DEVHUB_MCP_TOOLSETS }): void {
  const { dashboard } = ctx;

  registerAction(server, statusServices, { read: async () => dashboard.get<Record<string, { active: boolean; uptime: string | null }>>(
          "/api/status/services",
        ) }, (data) => {

        const entries = Object.entries(data);
        if (entries.length === 0) {
          return { content: [{ type: "text", text: "No dev services reported." }] };
        }
        const lines = entries.map(
          ([id, s]) => `- ${id}: ${s.active ? "active" : "inactive"}${s.uptime ? ` (up ${s.uptime})` : ""}`,
        );
        return { content: [{ type: "text", text: `Dev services:\n${lines.join("\n")}` }] };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult), { omitInputSchema: true });

  registerAction(server, statusExec, { read: async () => dashboard.get("/api/status/exec") }, (data) => {


        const running = data.inFlight.length
          ? data.inFlight
              .map(
                (c) =>
                  `- ${c.overdue ? "OVERDUE " : ""}${Math.round(c.runningMs / 1000)}s (limit ${Math.round(c.timeoutMs / 1000)}s): ${c.command}${c.cwd ? ` [${c.cwd}]` : ""}`,
              )
              .join("\n")
          : "- none";
        const slow = data.slowest.length
          ? data.slowest
              .slice(0, 10)
              .map(
                (c) =>
                  `- ${Math.round(c.durationMs)}ms${c.timedOut ? " TIMED OUT" : c.ok ? "" : " failed"}: ${c.command}`,
              )
              .join("\n")
          : "- none recorded";
        return {
          content: [
            { type: "text", text: `In flight now:\n${running}\n\nSlowest recent:\n${slow}` },
          ],
        };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult), { omitInputSchema: true });

  registerAction(server, statusLogs, {
    read: ({ source, lines }) => dashboard.get("/api/status/logs", { source, n: lines }),
  }, ({ data, filter }) => {
        const tail = data.lines;
        if (tail.length === 0) {
          return {
            content: [{ type: "text", text: `No log lines${filter ? ` matching "${filter}"` : ""} in ${data.logDir}.` }],
          };
        }
        return {
          content: [
            { type: "text", text: `${data.logDir} (${tail.length} line(s)):\n${tail.map((l) => l.raw).join("\n")}` },
          ],
        };
  }, (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult));

  registerAction(server, statusGit, { read: async () => dashboard.get<unknown>("/api/status/git") }, (data) => {

        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult), { omitInputSchema: true });

  registerAction(server, statusMcp, { read: async () => dashboard.get<StatusMcpResult>("/api/status/mcp") }, ({ servers }) => {

        // This connection is a first-class fact: a fresh harness user asking "is
        // the MCP link healthy?" gets the serving process itself in the answer,
        // not a registry list that may not know about it.
        const selected = selectToolsets(env.DEVHUB_MCP_TOOLSETS, availableToolsets).names.length;
        const self =
          `- devhub (this server): serving this call — v${SERVER_VERSION}, ` +
          `toolsets ${selected}/${availableToolsets.length}`;
        if (!Array.isArray(servers) || servers.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  `MCP servers:\n${self}\n\n` +
                  "The dashboard's registry lists MCP servers it launches itself; it does not track this connection.",
              },
            ],
          };
        }
        const lines = servers.map((m) => {
          const run = m.runningCount > 0 ? `running ×${m.runningCount} (pids ${m.pids.join(", ")})` : "not running";
          const bin = m.binaryExists ? "" : " · binary missing";
          return `- ${m.name}: ${run}${bin}`;
        });
        return { content: [{ type: "text", text: `MCP servers:\n${self}\n${lines.join("\n")}` }] };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult), { omitInputSchema: true });
}
