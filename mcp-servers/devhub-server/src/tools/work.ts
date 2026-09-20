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
        "List my open GitHub PRs (authored + awaiting my review) via the dashboard, including a CI checks glance (passing/failing/pending/none + counts) when available. Stash+checkout with prs_open_in_cursor; auto agent-review with prs_auto_review; toggle the poller with prs_auto_review_settings_get/set; dig into red builds with prs_pipeline_investigate. Pair with events_wait (kind=pr) / pr-state for live check waits. Requires the dashboard running and the GitHub CLI authenticated.",
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
    "prs_auto_review",
    {
      description:
        "Auto agent-review for review-requested PRs (same prompt/note path as the UI Review with agent action). Skips drafts, skip-until-updated PRs, and PRs already reviewed for the current updatedAt. Never posts GitHub review comments — only starts OpenCode review jobs that write notes under pr-reviews/. Dry-run by default; pass confirm:true to start (capped concurrency 1–2). Requires the dashboard running and gh authenticated.",
      inputSchema: {
        confirm: z
          .boolean()
          .optional()
          .describe("Required true to start reviews; omit or false for dry-run candidate listing"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe("Max reviews to start this call (1–2)"),
      },
    },
    async ({ confirm, limit }) =>
      withDashboardErrors(async () => {
        const dryRun = !confirm;
        const data = await dashboard.post<{
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
        }>(
          "/api/github/prs/auto-review",
          { dryRun, ...(limit !== undefined ? { limit } : {}) },
          120_000,
        );
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
      }),
  );

  server.registerTool(
    "prs_auto_review_settings_get",
    {
      description:
        "Read auto agent-review poller settings (enabled / always / source / intervalMs). Prefs live in notes/.config/auto-pr-review.json once saved; before that, values come from DEVHUB_AUTO_PR_REVIEW / DEVHUB_AUTO_PR_REVIEW_ALWAYS. Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          enabled: boolean;
          always: boolean;
          source: "prefs" | "env";
          intervalMs?: number;
        }>("/api/github/prs/auto-review/settings");
        const interval =
          typeof data.intervalMs === "number"
            ? ` every ${Math.round(data.intervalMs / 60000)}m`
            : "";
        const line =
          `Auto-review poller: ${data.enabled ? "enabled" : "disabled"}` +
          `${data.always ? " (always)" : " (weekday daytime)"}${interval}` +
          ` — source=${data.source}`;
        return { content: [{ type: "text", text: line }] };
      }),
  );

  server.registerTool(
    "prs_auto_review_settings_set",
    {
      description:
        "Set auto agent-review poller prefs (enabled / always) via the dashboard. Persists to notes/.config/auto-pr-review.json (prefs then win over env). Takes effect on the next poller tick (kicked immediately after save). Requires the dashboard running.",
      inputSchema: {
        enabled: z
          .boolean()
          .optional()
          .describe("Turn the in-process poller on or off"),
        always: z
          .boolean()
          .optional()
          .describe("When true, skip the weekday daytime window"),
      },
    },
    async ({ enabled, always }) =>
      withDashboardErrors(async () => {
        if (enabled === undefined && always === undefined) {
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
        const data = await dashboard.put<{
          enabled: boolean;
          always: boolean;
          source: "prefs" | "env";
          intervalMs?: number;
          error?: string;
        }>("/api/github/prs/auto-review/settings", {
          ...(enabled !== undefined ? { enabled } : {}),
          ...(always !== undefined ? { always } : {}),
        });
        const interval =
          typeof data.intervalMs === "number"
            ? ` every ${Math.round(data.intervalMs / 60000)}m`
            : "";
        const line =
          `Saved auto-review poller: ${data.enabled ? "enabled" : "disabled"}` +
          `${data.always ? " (always)" : " (weekday daytime)"}${interval}` +
          ` — source=${data.source}`;
        return { content: [{ type: "text", text: line }] };
      }),
  );

  server.registerTool(
    "prs_pipeline_investigate",
    {
      description:
        "Investigate CI/checks for one PR (same prompt/note path as the UI Investigate pipeline action). Uses the devhub-fix-pipeline skill via OpenCode — classifies flake vs real, may fix on the branch, writes findings to the PR review note. Never posts GitHub review comments. Dry-run / preview by default; pass confirm:true to start. Optional rerunFailed:true (with confirm) re-runs failed Actions on the PR head branch first. Prefer prs_list for queue glance, and events_wait (kind=pr, until=checks_done) / GET /api/github/pr-state for live waits. Requires the dashboard running and gh authenticated.",
      inputSchema: {
        repo: z.string().describe("owner/repo, e.g. acme/widgets"),
        number: z.number().int().positive().describe("PR number"),
        url: z.string().optional().describe("Optional full PR URL"),
        title: z.string().optional().describe("Optional PR title for the session label"),
        confirm: z
          .boolean()
          .optional()
          .describe("Required true to start the agent (and optional re-run)"),
        rerunFailed: z
          .boolean()
          .optional()
          .describe("With confirm:true, also re-run failed Actions for the PR head branch"),
        dryRun: z.boolean().optional().describe("Force preview even if confirm is set"),
      },
    },
    async ({ repo, number, url, title, confirm, rerunFailed, dryRun }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.post<{
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
        }>(
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
        );
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
