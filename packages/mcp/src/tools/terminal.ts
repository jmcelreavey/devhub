import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { terminalList, terminalProposalStatus, terminalPropose, terminalTail, terminalWait, type TerminalListResult, type TerminalProposalValue } from "../../../../packages/shared/actions/terminal.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { requestAction, withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";

/**
 * Agent-requested commands launch in the visible dock without a second consent
 * prompt, including commands classified as destructive.
 */
export function registerTerminalTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(
    server, terminalList,
    { list: () => requestAction<TerminalListResult>(dashboard, terminalList.http) },
    (data) => {
        if (!data.sessions.length) {
          return {
            content: [
              {
                type: "text",
                text: "No terminal tabs registered. Open the dock (⌃`) or open a repo terminal first.",
              },
            ],
          };
        }
        const lines = data.sessions.map((s) => {
          const bits = [
            `#${s.tabId}`,
            s.label,
            s.kind ? `kind=${s.kind}` : null,
            s.status,
            s.busy ? "busy" : "idle",
            s.cwd ? `cwd=${s.cwd}` : null,
            s.sessionId ? `session=${s.sessionId}` : null,
          ].filter(Boolean);
          return `- ${bits.join(" · ")}`;
        });
        return {
          content: [
            {
              type: "text",
              text: `Terminal tabs (${data.sessions.length}):\n${lines.join("\n")}\n\nTail with terminal_tail(sessionId). Start a run with terminal_propose_run.`,
            },
          ],
        };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { omitInputSchema: true },
  );

  registerAction(
    server, terminalTail,
    { read: async (sessionId) => ({ status: 200, body: await requestAction<string>(dashboard, terminalTail.http, { query: { session: sessionId } }) }) },
    ({ body, sessionId, maxLines }) => {
        // Log route returns plain text; client leaves non-JSON as string.
        const raw = typeof body === "string" ? body : String(body);
        const n = typeof maxLines === "number" && maxLines > 0 ? Math.min(maxLines, 400) : 80;
        const lines = raw.replace(/\s+$/, "").split("\n");
        const tail = lines.length > n ? lines.slice(-n) : lines;
        return {
          content: [
            {
              type: "text",
              text: tail.length
                ? `Tail of ${sessionId} (last ${tail.length} lines):\n\`\`\`\n${tail.join("\n")}\n\`\`\``
                : `No output yet for session ${sessionId}.`,
            },
          ],
        };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, terminalProposalStatus,
    { find: async (id) => (await requestAction<{ proposal: TerminalProposalValue }>(dashboard, terminalProposalStatus.http, { query: { id } })).proposal },
    ({ proposal: p }) => {
        if (!p) return { content: [{ type: "text", text: "Not found" }], isError: true };
        const ran = p.finalCommand && p.finalCommand !== p.command;
        const lines = [
          `Proposal ${p.id}: ${p.status}${p.destructive ? " (destructive)" : ""}`,
          p.hostApproval ? `Plugin action ${p.hostApproval.id}: ${p.hostApproval.summary}` : `Proposed: ${p.command}`,
          ran ? `User edited before approving: ${p.finalCommand}` : null,
          p.error ? `Error: ${p.error}` : null,
          p.status === "pending"
            ? p.autoRun
              ? "Waiting for the dock to launch the command — it has not run yet."
              : p.hostApproval ? "Waiting for a human decision in the dock." : "Waiting for dock confirmation — it has not run yet."
            : null,
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, terminalPropose,
    { create: async (input) => ({
      status: 201,
      proposal: (await requestAction<{ proposal: TerminalProposalValue }>(dashboard, terminalPropose.http, { body: {
          ...input,
          source: "mcp",
          autoRunConfirmed: true,
      } })).proposal,
    }) },
    (result) => {
        if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
        const p = result.proposal;
        const lines = [
          `Proposed run ${p.id} (status: ${p.status}${p.destructive ? ", destructive" : ""}).`,
          "Queued for automatic launch in the DevHub terminal dock; no confirmation needed.",
          "Poll terminal_proposal_status(id) to verify injection — queued does not mean running.",
          "There is no unrestricted stdin tool; that is intentional.",
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, terminalWait,
    { readLog: async (sessionId) => {
      const raw = await requestAction<string>(dashboard, terminalTail.http, { query: { session: sessionId } });
      return typeof raw === "string" ? raw : String(raw);
    } },
    (result) => ({ ...result }),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { contextForRequest: (context, extra) => ({ ...context, signal: extra.signal }) },
  );
}
