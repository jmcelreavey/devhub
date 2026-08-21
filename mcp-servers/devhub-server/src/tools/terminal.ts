import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

/**
 * Terminal tools for OpenCode / agents.
 *
 * `terminal_propose_run` never injects stdin. It queues a proposal on the
 * dashboard; TerminalDock shows confirm/edit/deny. Desktop tickets alone are
 * not user intent.
 */
export function registerTerminalTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "terminal_list",
    {
      description:
        "List DevHub terminal dock tabs (label, cwd, kind, busy, session id). Requires the dashboard running with the terminal dock open at least once this session.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          sessions: Array<{
            tabId: number;
            sessionId: string | null;
            label: string;
            cwd?: string;
            kind?: string;
            repoName?: string;
            status: string;
            busy: boolean;
          }>;
        }>("/api/terminal/sessions");
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
              text: `Terminal tabs (${data.sessions.length}):\n${lines.join("\n")}\n\nTail with terminal_tail(sessionId). Propose a run with terminal_propose_run (UI must confirm).`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "terminal_tail",
    {
      description:
        "Read the cleaned (ANSI-stripped) tail of a terminal session log by session id from terminal_list. Requires the dashboard running.",
      inputSchema: {
        sessionId: z.string().describe("Session UUID from terminal_list"),
        maxLines: z.number().optional().describe("Max trailing lines (default 80)"),
      },
    },
    async ({ sessionId, maxLines }) =>
      withDashboardErrors(async () => {
        const text = await dashboard.get<string>("/api/terminal/log", {
          session: sessionId,
        });
        // Log route returns plain text; client leaves non-JSON as string.
        const raw = typeof text === "string" ? text : String(text);
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
      }),
  );

  server.registerTool(
    "terminal_proposal_status",
    {
      description:
        "Check the outcome of a terminal_propose_run proposal. Returns pending / approved / injected / denied / expired / failed. Poll this instead of assuming a proposal was approved. Requires the dashboard running.",
      inputSchema: {
        id: z.string().describe("Proposal id returned by terminal_propose_run"),
      },
    },
    async ({ id }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          proposal: {
            id: string;
            status: string;
            command: string;
            finalCommand?: string;
            destructive: boolean;
            error?: string;
          };
        }>("/api/terminal/propose", { id });
        const p = data.proposal;
        const ran = p.finalCommand && p.finalCommand !== p.command;
        const lines = [
          `Proposal ${p.id}: ${p.status}${p.destructive ? " (destructive)" : ""}`,
          `Proposed: ${p.command}`,
          ran ? `User edited before approving: ${p.finalCommand}` : null,
          p.error ? `Error: ${p.error}` : null,
          p.status === "pending" ? "Still waiting on the user — do not proceed as if it ran." : null,
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }),
  );

  server.registerTool(
    "terminal_propose_run",
    {
      description:
        "Propose a command to run in the DevHub terminal dock. Does NOT execute it. The user must confirm/edit/deny in the dock UI. Prefer preferAgentTab for agent work so long-running devservers are not stomped. Requires the dashboard running.",
      inputSchema: {
        command: z.string().describe("Shell command to propose"),
        cwd: z.string().optional().describe("Absolute cwd under the user home"),
        label: z.string().optional().describe("Tab label"),
        summary: z
          .string()
          .optional()
          .describe("Friendly chip copy (preferred over dumping the raw command)"),
        kind: z
          // Keep in sync with dashboard/lib/terminal-meta.ts TERMINAL_SESSION_KINDS
          .enum(["shell", "agent", "review", "upstart", "devserver", "capture"])
          .optional()
          .describe("Session intent metadata"),
        repoName: z.string().optional(),
        preferAgentTab: z
          .boolean()
          .optional()
          .describe("Default true — use a dedicated Agent tab"),
        reason: z.string().optional().describe("Shown in the confirm chip"),
      },
    },
    async ({ command, cwd, label, summary, kind, repoName, preferAgentTab, reason }) =>
      withDashboardErrors(async () => {
        const created = await dashboard.post<{
          proposal: { id: string; destructive: boolean; status: string };
        }>("/api/terminal/propose", {
          command,
          cwd,
          label,
          summary,
          kind,
          repoName,
          preferAgentTab: preferAgentTab !== false,
          reason,
          source: "mcp",
        });
        const p = created.proposal;
        return {
          content: [
            {
              type: "text",
              text: [
                `Proposed run ${p.id} (status: ${p.status}${p.destructive ? ", destructive" : ""}).`,
                "Waiting for the user to confirm in the DevHub terminal dock.",
                "Poll terminal_proposal_status(id) if you need the outcome — do not assume approval.",
                "There is no unrestricted stdin tool; that is intentional.",
              ].join("\n"),
            },
          ],
        };
      }),
  );
}
