import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import { listWidgetHtml, uiResult } from "../ui.ts";

interface PrRow {
  number: number;
  title: string;
  url: string;
  repo: string;
}

interface JiraTicket {
  key?: string;
  summary?: string;
  status?: string;
  [k: string]: unknown;
}

interface JiraTicketDetail {
  key: string;
  status?: string | { name?: string };
  summary?: string;
  issuetype?: string;
}

export function formatJiraTicket(ticket: JiraTicketDetail): string {
  const status = typeof ticket.status === "string" ? ticket.status : ticket.status?.name ?? "?";
  return `${ticket.key} [${status}]${ticket.issuetype ? ` (${ticket.issuetype})` : ""}\n${ticket.summary ?? ""}`.trimEnd();
}

export function registerWorkTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "prs_list",
    {
      description:
        "List my open GitHub PRs (authored + awaiting my review) via the dashboard. Stash+checkout a PR into Cursor with prs_open_in_cursor. Requires the dashboard running and the GitHub CLI authenticated.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          configured: boolean;
          authored?: PrRow[];
          reviews?: PrRow[];
          recentlyReviewed?: PrRow[];
        }>("/api/github/prs");
        if (!data.configured) {
          return {
            content: [{ type: "text", text: "GitHub CLI not authenticated — run `gh auth login` then retry." }],
            isError: true,
          };
        }
        const fmt = (rows: PrRow[] = []) =>
          rows.length ? rows.map((p) => `  - ${p.repo}#${p.number} ${p.title}\n    ${p.url}`).join("\n") : "  (none)";
        const out = [
          `Authored (${data.authored?.length ?? 0}):`,
          fmt(data.authored),
          `\nAwaiting my review (${data.reviews?.length ?? 0}):`,
          fmt(data.reviews),
        ];
        const items = [
          ...(data.authored ?? []).map((p) => ({
            label: `${p.repo}#${p.number} ${p.title}`,
            meta: "authored",
          })),
          ...(data.reviews ?? []).map((p) => ({
            label: `${p.repo}#${p.number} ${p.title}`,
            meta: "review",
          })),
        ];
        const html = items.length ? listWidgetHtml("Pull requests", "Open PRs", items) : null;
        return uiResult(out.join("\n"), html, "ui://devhub/prs");
      }),
  );

  server.registerTool(
    "prs_open_in_cursor",
    {
      description:
        "Open a PR in Cursor: stash dirty work in the local clone, gh pr checkout, then launch Cursor on that repo (same as the PR row Open in Cursor action). Optional notePath also opens a notes working copy. Mutates git — requires confirm:true. Requires the dashboard running. repos_open only opens the current branch.",
      inputSchema: {
        repo: z.string().describe("owner/repo, e.g. acme/widgets"),
        number: z.number().int().positive().describe("PR number"),
        notePath: z
          .string()
          .optional()
          .describe("Optional notes-relative path (e.g. pr-reviews/acme-widgets-9) to open alongside"),
        confirm: z.boolean().optional().describe("Required true to stash/checkout and launch Cursor"),
      },
    },
    async ({ repo, number, notePath, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Would stash dirty work in the local clone of ${repo}, check out PR #${number}, and open it in Cursor` +
                  (notePath ? ` with note ${notePath}` : "") +
                  `. Re-run with confirm: true.`,
              },
            ],
            isError: true,
          };
        }
        const data = await dashboard.post<{
          ok?: boolean;
          localRepoName?: string;
          branch?: string;
          stashed?: boolean;
          alreadyOnBranch?: boolean;
          writable?: boolean;
        }>("/api/github/prs/open-in-cursor", { repo, number, notePath }, 120_000);
        const bits = [
          data.alreadyOnBranch ? "already on branch" : `checked out ${data.branch ?? "PR branch"}`,
          data.stashed ? "stashed local changes" : null,
          data.localRepoName ? `repo ${data.localRepoName}` : null,
        ].filter(Boolean);
        return {
          content: [
            {
              type: "text",
              text: `Opened ${repo}#${number} in Cursor (${bits.join("; ")}).`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "jira_tickets",
    {
      description:
        "List my assigned Jira tickets via the dashboard. Requires the dashboard running and Jira configured in /setup.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ tickets?: JiraTicket[]; configured: boolean }>("/api/jira/tickets");
        if (!data.configured) {
          return { content: [{ type: "text", text: "Jira not configured — set it up in /setup." }], isError: true };
        }
        const tickets = data.tickets ?? [];
        if (tickets.length === 0) {
          return { content: [{ type: "text", text: "No assigned Jira tickets." }] };
        }
        const lines = tickets.map((t) => {
          if (t.key || t.summary) return `- ${t.key ?? "?"} [${t.status ?? "?"}] ${t.summary ?? ""}`.trimEnd();
          return `- ${JSON.stringify(t)}`;
        });
        return { content: [{ type: "text", text: `My Jira tickets:\n${lines.join("\n")}` }] };
      }),
  );

  server.registerTool(
    "jira_ticket_get",
    {
      description: "Fetch a single Jira ticket (status, summary, issue type) by key, e.g. DAD-1234. Requires the dashboard running.",
      inputSchema: {
        key: z.string().describe("Jira ticket key, e.g. DAD-1234"),
      },
    },
    async ({ key }) =>
      withDashboardErrors(async () => {
        const t = await dashboard.get<JiraTicketDetail>(`/api/jira/ticket/${encodeURIComponent(key)}`);
        return {
          content: [
            {
              type: "text",
              text: formatJiraTicket(t),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "standup_markdown",
    {
      description:
        "Generate a standup digest (commits, merged/authored PRs, Jira activity, tasks) as markdown via the dashboard. Defaults to yesterday→today. Requires the dashboard running.",
      inputSchema: {
        startDate: z.string().optional().describe("Range start YYYY-MM-DD (default: yesterday)"),
        endDate: z.string().optional().describe("Range end YYYY-MM-DD (default: today)"),
      },
    },
    async ({ startDate, endDate }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ markdown?: string }>(
          "/api/standup/markdown",
          { startDate, endDate },
          60_000,
        );
        return { content: [{ type: "text", text: data.markdown?.trim() || "Standup digest was empty." }] };
      }),
  );

  server.registerTool(
    "tasks_weekly",
    {
      description:
        "Weekly task review: per-day created/completed/abandoned/moved totals plus slipped (repeatedly-moved) tasks, ending on a given date. Requires the dashboard running.",
      inputSchema: {
        end: z.string().optional().describe("End date YYYY-MM-DD (defaults to today; covers the 7 days ending then)"),
      },
    },
    async ({ end }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.get<{
          start: string;
          end: string;
          totals?: { created?: number; completed?: number; abandoned?: number; moved?: number };
          days?: Array<{ date: string; created: number; completed: number; abandoned: number; moved: number }>;
          slipped?: Array<{ text?: string }>;
        }>("/api/tasks/weekly", { end });
        const t = r.totals ?? {};
        const dayLines = (r.days ?? [])
          .map((d) => `  ${d.date}: +${d.created} created, ${d.completed} done, ${d.abandoned} dropped, ${d.moved} moved`)
          .join("\n");
        const slipped = (r.slipped ?? []).slice(0, 10).map((s) => `  - ${s.text ?? "(task)"}`).join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                `Week ${r.start} → ${r.end}: ${t.completed ?? 0} done, ${t.created ?? 0} created, ${t.abandoned ?? 0} dropped, ${t.moved ?? 0} moved.\n` +
                `${dayLines}` +
                (slipped ? `\n\nSlipping (kept moving):\n${slipped}` : ""),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "jira_ticket_transition",
    {
      description:
        "Move a Jira ticket to a new workflow state. Call without transitionId to list the available transitions; then call with a transitionId and confirm:true to apply it. Requires the dashboard running.",
      inputSchema: {
        key: z.string().describe("Jira ticket key, e.g. DAD-1234"),
        transitionId: z.string().optional().describe("Transition id (from the listing). Omit to list options."),
        confirm: z.boolean().optional().describe("Required (true) to actually apply the transition"),
      },
    },
    async ({ key, transitionId, confirm }) =>
      withDashboardErrors(async () => {
        if (!transitionId) {
          const data = await dashboard.get<{ transitions?: Array<{ id: string; name: string }> }>(
            `/api/jira/ticket/${encodeURIComponent(key)}/transitions`,
          );
          const ts = data.transitions ?? [];
          if (ts.length === 0) {
            return { content: [{ type: "text", text: `No transitions available for ${key}.` }] };
          }
          const lines = ts.map((t) => `- ${t.id}: ${t.name}`);
          return {
            content: [
              {
                type: "text",
                text: `Available transitions for ${key}:\n${lines.join("\n")}\n\nApply with jira_ticket_transition(key, transitionId, confirm: true).`,
              },
            ],
          };
        }
        if (!confirm) {
          return {
            content: [
              { type: "text", text: `Applying transition ${transitionId} to ${key} changes the ticket. Re-run with confirm: true.` },
            ],
            isError: true,
          };
        }
        await dashboard.post<{ key: string; ok: boolean }>(
          `/api/jira/ticket/${encodeURIComponent(key)}/transition`,
          { transitionId },
        );
        return { content: [{ type: "text", text: `Moved ${key} via transition ${transitionId}.` }] };
      }),
  );
}
