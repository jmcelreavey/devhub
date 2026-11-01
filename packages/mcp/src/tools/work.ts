import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jiraTicketAssign, jiraTicketCreate, jiraTicketGet, jiraTickets, jiraTicketTransition, prAutoReview, prAutoReviewSettingsGet, prAutoReviewSettingsSet, prList, prOpen, prPipelineInvestigate, standupMarkdown, tasksWeekly } from "../../../../packages/shared/actions/work.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";
import { listWidgetHtml, uiResult } from "../ui.ts";

interface PrRow {
  number: number;
  title: string;
  url: string;
  repo: string;
  checks?: "passing" | "failing" | "pending" | "none";
  checkCounts?: { passed: number; failed: number; pending: number };
  approved?: boolean;
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
  /** Present on newer dashboards; null = unassigned, undefined = not reported. */
  assignee?: { accountId?: string; displayName?: string; email?: string } | null;
}

export function formatJiraTicket(ticket: JiraTicketDetail): string {
  const status = typeof ticket.status === "string" ? ticket.status : ticket.status?.name ?? "?";
  const head = `${ticket.key} [${status}]${ticket.issuetype ? ` (${ticket.issuetype})` : ""}\n${ticket.summary ?? ""}`.trimEnd();
  if (ticket.assignee === undefined) return head;
  const who = ticket.assignee
    ? `${ticket.assignee.displayName || ticket.assignee.email || "?"}${ticket.assignee.accountId ? ` (${ticket.assignee.accountId})` : ""}`
    : "Unassigned";
  return `${head}\nAssignee: ${who}`;
}

export function registerWorkTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(
    server, prList,
    { list: async () => ({ status: 200, body: await dashboard.get("/api/github/prs") }) },
    (response) => {
        const data = response.body as {
          configured: boolean;
          authored?: PrRow[];
          reviews?: PrRow[];
          recentlyReviewed?: PrRow[];
        };
        if (!data.configured) {
          return {
            content: [{ type: "text", text: "GitHub CLI not authenticated — run `gh auth login` then retry." }],
            isError: true,
          };
        }
        const fmt = (rows: PrRow[] = []) =>
          rows.length
            ? rows
                .map((p) => {
                  const checks =
                    p.checks && p.checks !== "none"
                      ? p.checkCounts
                        ? ` [${p.checks}: ${p.checkCounts.passed}✓ ${p.checkCounts.failed}✗ ${p.checkCounts.pending}…]`
                        : ` [${p.checks}]`
                      : "";
                  const approved = p.approved ? " ✓approved" : "";
                  return `  - ${p.repo}#${p.number}${checks}${approved} ${p.title}\n    ${p.url}`;
                })
                .join("\n")
            : "  (none)";
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
        return { ...uiResult(out.join("\n"), html, "ui://devhub/prs"), structuredContent: { authored: data.authored ?? [], reviews: data.reviews ?? [] } };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { omitInputSchema: true },
  );

  registerAction(
    server, prOpen,
    { open: async (input) => ({ status: 200, body: await dashboard.post("/api/github/prs/open-in-cursor", input, 120_000) }) },
    (result) => {
        const { repo, number } = result;
        if (result.kind === "preview") {
          return {
            content: [
              {
                type: "text",
                text:
                  `Would stash dirty work in the local clone of ${repo}, check out PR #${number}, and open it in Cursor` +
                  (result.notePath ? ` with note ${result.notePath}` : "") +
                  `. Re-run with confirm: true.`,
              },
            ],
            isError: true,
          };
        }
        const data = result.response.body as {
          ok?: boolean;
          localRepoName?: string;
          branch?: string;
          stashed?: boolean;
          alreadyOnBranch?: boolean;
          writable?: boolean;
        };
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
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, prAutoReview,
    { review: async (input) => ({ status: 200, body: await dashboard.post("/api/github/prs/auto-review", input, 120_000) }) },
    ({ dryRun, response }) => {
        const data = response.body as {
          dryRun?: boolean;
          configured?: boolean;
          started?: Array<{
            repo: string;
            number: number;
            url: string;
            runId?: string;
            sessionId?: string;
            notePath?: string;
          }>;
          skipped?: Array<{ repo: string; number: number; url: string; reason: string }>;
          errors?: Array<{ repo: string; number: number; url: string; error: string }>;
          candidates?: Array<{ row: { repo: string; number: number; url: string; title?: string }; notePath: string }>;
          error?: string;
        };
        if (data.configured === false) {
          return {
            content: [{ type: "text", text: "GitHub CLI not authenticated — run `gh auth login` then retry." }],
            isError: true,
          };
        }
        const lines: string[] = [
          dryRun ? "Dry-run (no reviews started). Re-run with confirm: true to start." : "Auto-review pass complete.",
        ];
        if (data.candidates?.length) {
          lines.push(`Candidates (${data.candidates.length}):`);
          for (const c of data.candidates) {
            lines.push(`  - ${c.row.repo}#${c.row.number} → ${c.notePath}`);
          }
        }
        if (data.started?.length) {
          lines.push(`Started (${data.started.length}):`);
          for (const s of data.started) {
            const id = s.runId ? `run ${s.runId}` : `session ${s.sessionId ?? "?"}`;
            lines.push(`  - ${s.repo}#${s.number} ${id} note ${s.notePath ?? "?"}`);
          }
        }
        if (data.skipped?.length) {
          lines.push(`Skipped (${data.skipped.length}):`);
          for (const s of data.skipped.slice(0, 20)) {
            lines.push(`  - ${s.repo}#${s.number}: ${s.reason}`);
          }
          if (data.skipped.length > 20) lines.push(`  …and ${data.skipped.length - 20} more`);
        }
        if (data.errors?.length) {
          lines.push(`Errors (${data.errors.length}):`);
          for (const e of data.errors) {
            lines.push(`  - ${e.repo}#${e.number}: ${e.error}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, prAutoReviewSettingsGet,
    { read: async () => ({ status: 200, body: await dashboard.get("/api/github/prs/auto-review/settings") }) },
    (response) => {
        const data = response.body as {
          enabled: boolean;
          always: boolean;
          source: "prefs" | "env";
          intervalMs?: number;
        };
        const interval =
          typeof data.intervalMs === "number"
            ? ` every ${Math.round(data.intervalMs / 60000)}m`
            : "";
        const line =
          `Auto-review poller: ${data.enabled ? "enabled" : "disabled"}` +
          `${data.always ? " (always)" : " (weekday daytime)"}${interval}` +
          ` — source=${data.source}`;
        return { content: [{ type: "text", text: line }] };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { omitInputSchema: true },
  );

  registerAction(
    server, prAutoReviewSettingsSet,
    { save: async (input) => ({ status: 200, body: await dashboard.put("/api/github/prs/auto-review/settings", input) }) },
    (result) => {
        if (result.kind === "missing") {
          return {
            content: [
              {
                type: "text",
                text: "Provide at least one of enabled or always.",
              },
            ],
            isError: true,
          };
        }
        const data = result.response.body as {
          enabled: boolean;
          always: boolean;
          source: "prefs" | "env";
          intervalMs?: number;
          error?: string;
        };
        const interval =
          typeof data.intervalMs === "number"
            ? ` every ${Math.round(data.intervalMs / 60000)}m`
            : "";
        const line =
          `Saved auto-review poller: ${data.enabled ? "enabled" : "disabled"}` +
          `${data.always ? " (always)" : " (weekday daytime)"}${interval}` +
          ` — source=${data.source}`;
        return { content: [{ type: "text", text: line }] };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, prPipelineInvestigate,
    { investigate: async ({ repo, number, url, title, confirm, rerunFailed, dryRun }) => ({
      status: 200,
      body: await dashboard.post(
        "/api/github/prs/pipeline-investigate",
        {
          repo,
          number,
          ...(url ? { url } : {}),
          ...(title ? { title } : {}),
          ...(confirm !== undefined ? { confirm } : {}),
          ...(rerunFailed !== undefined ? { rerunFailed } : {}),
          ...(dryRun !== undefined ? { dryRun } : {}),
        },
        120_000,
      ),
    }) },
    (response) => {
        const data = response.body as {
          configured?: boolean;
          dryRun?: boolean;
          notePath?: string;
          prompt?: string;
          message?: string;
          error?: string;
          started?: {
            repo: string;
            number: number;
            url: string;
            runId?: string;
            sessionId?: string;
            providerLabel?: string;
            notePath?: string;
          };
          rerun?: { attempted: number; reran: number; runIds: number[]; errors: string[] } | null;
        };
        if (data.configured === false) {
          return {
            content: [
              {
                type: "text",
                text: data.error ?? "GitHub CLI not authenticated — run `gh auth login` then retry.",
              },
            ],
            isError: true,
          };
        }
        if (data.dryRun || !data.started) {
          const lines = [
            data.message ?? "Dry-run (no agent started). Re-run with confirm: true to start.",
            data.notePath ? `Note path: ${data.notePath}` : null,
            data.prompt ? `Prompt: ${data.prompt}` : null,
          ].filter(Boolean);
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        const lines = [
          `Started pipeline investigate for ${data.started.repo}#${data.started.number}.`,
          `${data.started.providerLabel ?? "agent"} ${
            data.started.runId ? `run ${data.started.runId}` : `session ${data.started.sessionId ?? "?"}`
          } · note ${data.started.notePath ?? "?"}`,
        ];
        if (data.rerun) {
          lines.push(
            `Re-run failed: attempted ${data.rerun.attempted}, reran ${data.rerun.reran}` +
              (data.rerun.runIds.length ? ` (runs ${data.rerun.runIds.join(", ")})` : ""),
          );
          if (data.rerun.errors.length) {
            lines.push(`Re-run errors: ${data.rerun.errors.join("; ")}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, jiraTickets,
    { list: async () => ({ status: 200, body: await dashboard.get("/api/jira/tickets") }) },
    (response) => {
        const data = response.body as { tickets?: JiraTicket[]; configured: boolean };
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
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { omitInputSchema: true },
  );

  registerAction(
    server, jiraTicketCreate,
    { create: async (input) => ({ status: 201, body: await dashboard.post("/api/jira/issue", input, 60_000) }) },
    (result) => {
        const { input } = result;
        if (result.kind === "preview") {
          return {
            content: [{ type: "text", text: `Create a Jira ticket in ${input.projectKey}: ${input.summary}${input.parentKey ? ` (parent ${input.parentKey})` : ""}. Re-run with confirm: true.` }],
            isError: true,
          };
        }
        const created = result.response.body as { key: string; url: string };

        return {
          content: [{ type: "text", text: `Created ${created.key}: ${input.summary}\n${created.url}` }],
          structuredContent: created,
        };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, jiraTicketGet,
    { get: async (key) => ({ status: 200, body: await dashboard.get(`/api/jira/ticket/${encodeURIComponent(key)}`) }) },
    (response) => {
        const t = response.body as JiraTicketDetail;
        return {
          content: [
            {
              type: "text",
              text: formatJiraTicket(t),
            },
          ],
        };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, standupMarkdown,
    { read: async ({ startDate, endDate }) => ({ status: 200, body: await dashboard.get("/api/standup/markdown", { startDate, endDate }, 60_000) }) },
    (response) => {
        const data = response.body as { markdown?: string };
        return { content: [{ type: "text", text: data.markdown?.trim() || "Standup digest was empty." }] };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, tasksWeekly,
    { read: async (end) => ({ status: 200, body: await dashboard.get("/api/tasks/weekly", { end }) }) },
    (response) => {
        const r = response.body as {
          start: string;
          end: string;
          totals?: { created?: number; completed?: number; abandoned?: number; moved?: number };
          days?: Array<{ date: string; created: number; completed: number; abandoned: number; moved: number }>;
          slipped?: Array<{ text?: string }>;
        };
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
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, jiraTicketTransition,
    {
      list: async (key) => ({ status: 200, body: await dashboard.get(`/api/jira/ticket/${encodeURIComponent(key)}/transitions`) }),
      move: async (key, body) => ({ status: 200, body: await dashboard.post(`/api/jira/ticket/${encodeURIComponent(key)}/transition`, body) }),
    },
    (result) => {
        const { key } = result;
        if (result.kind === "list") {
          const data = result.response.body as { transitions?: Array<{ id: string; name: string }> };
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
        const { transitionId } = result;
        if (result.kind === "preview") {
          return {
            content: [
              { type: "text", text: `Applying transition ${transitionId} to ${key} changes the ticket. Re-run with confirm: true.` },
            ],
            isError: true,
          };
        }
        const moved = result.response.body as { key: string; ok: boolean; from?: string | null; to?: string | null };
        const fromTo = moved.to ? ` (${moved.from ? `${moved.from} → ` : ""}${moved.to})` : "";
        return { content: [{ type: "text", text: `Moved ${key} via transition ${transitionId}${fromTo}.` }] };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, jiraTicketAssign,
    { assign: async (key, assignee) => ({ status: 200, body: await dashboard.post(`/api/jira/ticket/${encodeURIComponent(key)}/assign`, { assignee }) }) },
    (result) => {
        const { key, assignee: who } = result;
        if (result.kind === "preview") {
          return {
            content: [{ type: "text", text: `Assigning ${key} to ${who} changes the ticket. Re-run with confirm: true.` }],
            isError: true,
          };
        }
        const done = result.response.body as { key: string; ok?: boolean; assignee?: string | null; assigneeAccountId?: string | null; from?: string | null };
        const name = done.assignee || who;
        const from = done.from ? ` (was ${done.from})` : " (was unassigned)";
        return {
          content: [{ type: "text", text: `Assigned ${key} to ${name}${from}.` }],
          structuredContent: done,
        };
      },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );
}
