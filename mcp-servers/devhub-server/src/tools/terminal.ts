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
        "Propose a command in the DevHub terminal dock (visible logs). Does NOT execute it — the user confirms in the dock. Prefer this over running a command in the agent/Cursor shell: the dock is where the user can see it, keep it, and kill it. Always use it for upstarts, dev servers, Expo, and anything long-running or user-visible. Every approved proposal opens its own tab, so nothing ever waits on another session. Requires the dashboard running.",
      inputSchema: {
        command: z.string().describe("Shell command to propose"),
        cwd: z.string().optional().describe("Absolute cwd under the user home"),
        label: z.string().optional().describe("Tab label — how the user tells this run apart in the dock"),
        summary: z
          .string()
          .optional()
          .describe("Friendly chip copy (preferred over dumping the raw command)"),
        kind: z
          // Keep in sync with dashboard/lib/terminal-meta.ts TERMINAL_SESSION_KINDS
          .enum(["shell", "agent", "review", "upstart", "devserver", "capture"])
          .optional()
          .describe("Tab chrome only; every kind gets its own tab"),
        repoName: z.string().optional(),
        reason: z.string().optional().describe("Shown in the confirm chip"),
      },
    },
    async ({ command, cwd, label, summary, kind, repoName, reason }) =>
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

  server.registerTool(
    "terminal_wait_for",
    {
      description:
        "Block until output in a DevHub terminal session matches a regex (a dev server's \"ready on\" line, a test summary, an error) or the timeout passes. By default only output written after the call starts counts. Use instead of polling terminal_tail. Requires the dashboard running.",
      inputSchema: {
        sessionId: z.string().describe("Session UUID from terminal_list"),
        pattern: z.string().min(1).max(500).describe("JavaScript regular expression, e.g. ready on|listening"),
        flags: z
          .string()
          .regex(/^[imsu]*$/)
          .optional()
          .describe("Regex flags: any of i, m, s, u"),
        // Under the 360s toolTimeoutSec harnesses get from mcp/shared/devhub.json.
        timeoutSeconds: z.number().int().min(1).max(300).optional().describe("Default 60, max 300"),
        includeExisting: z.boolean().optional().describe("Also match output that was already there"),
      },
    },
    async ({ sessionId, pattern, flags, timeoutSeconds, includeExisting }, extra) =>
      withDashboardErrors(async () => {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, flags ?? "");
        } catch (err) {
          return {
            content: [{ type: "text", text: `Invalid pattern: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
        const readLog = async () => {
          const raw = await dashboard.get<string>("/api/terminal/log", { session: sessionId });
          return typeof raw === "string" ? raw : String(raw);
        };
        const tailLines = (value: string) => value.replace(/\s+$/, "").split("\n").slice(-20).join("\n");
        // Bound the scan so a pathological pattern can't chew through a huge log every second.
        const SCAN_MAX = 200_000;
        const timeout = timeoutSeconds ?? 60;
        const deadline = Date.now() + timeout * 1_000;

        let log = await readLog();
        let offset = includeExisting ? 0 : log.length;
        for (;;) {
          const fresh = log.slice(offset);
          const scan = fresh.length > SCAN_MAX ? fresh.slice(-SCAN_MAX) : fresh;
          const match = regex.exec(scan);
          if (match) {
            const lineStart = scan.lastIndexOf("\n", match.index) + 1;
            const lineEnd = scan.indexOf("\n", match.index);
            const line = scan.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
            return {
              content: [
                {
                  type: "text",
                  text: `Matched /${pattern}/${flags ?? ""} in ${sessionId}:\n${line}\n\nRecent output:\n\`\`\`\n${tailLines(log)}\n\`\`\``,
                },
              ],
            };
          }
          if (Date.now() >= deadline || extra.signal.aborted) {
            return {
              content: [
                {
                  type: "text",
                  text: `No match for /${pattern}/${flags ?? ""} within ${timeout}s.\n\nRecent output:\n\`\`\`\n${tailLines(log)}\n\`\`\``,
                },
              ],
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          log = await readLog();
          // The dock's log can be cleared or rotated under us.
          if (log.length < offset) offset = 0;
        }
      }),
  );
}
