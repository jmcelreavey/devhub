/**
 * The plan loop: capture an idea as a draft, write it up, mark it ready, watch
 * the PR the agent opens, and learn from what finished. Dashboard-backed.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const taskId = z.string().trim().min(1).max(128).describe("DevHub task UUID");

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

interface CaptureResponse {
  task: { id: string; text: string };
  date: string;
  notePath: string;
  context: { notes: unknown[]; prs: unknown[]; tasks: unknown[]; alerts: unknown[] };
}

interface PrWatchResponse {
  checked: number;
  attention: number;
  merged: number;
  closed: number;
}

export function registerPlanTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "tasks_capture",
    {
      description:
        "Capture an idea as a DRAFT task (not ready for an agent yet). Saves a context snapshot — related notes, PRs, earlier tasks, recent alerts — into the task note under ## Context snapshot, plus an empty ## Open questions. Use for anything you or the user want to remember to look at later.",
      inputSchema: {
        text: z.string().trim().min(1).max(500).describe("One-line task title"),
        detail: z.string().max(10_000).optional().describe("Longer description, e.g. the Slack message or alert text"),
        date: date.optional().describe("Task day (default today)"),
      },
    },
    async ({ text: title, detail, date: day }) =>
      withDashboardErrors(async () => {
        const res = await dashboard.post<CaptureResponse>("/api/tasks/capture", { text: title, detail, date: day });
        const c = res.context;
        return text(
          `Captured draft ${res.task.id} on ${res.date}: ${res.task.text}\n` +
            `Note: ${res.notePath}\n` +
            `Context: ${c.notes.length} note(s), ${c.prs.length} PR(s), ${c.tasks.length} earlier task(s), ${c.alerts.length} alert(s).`,
        );
      }),
  );

  server.registerTool(
    "tasks_set_stage",
    {
      description:
        "Move a task between draft and ready. 'ready' runs the implement checklist (plan/acceptance written, no unanswered ## Open questions, one repo linked, no open prerequisites) and fails listing the gaps unless force is true. Use at the end of a plan-writing pass.",
      inputSchema: {
        taskId,
        date: date.describe("Task day"),
        stage: z.enum(["draft", "ready"]),
        force: z.boolean().optional().describe("Mark ready despite checklist gaps — only when the user says so"),
      },
    },
    async (input) =>
      withDashboardErrors(async () => {
        const task = await dashboard.post<{ id: string; text: string; stage?: string }>("/api/tasks/stage", input);
        return text(`Task ${task.id} is now ${task.stage ?? "ready"}: ${task.text}`);
      }),
  );

  server.registerTool(
    "tasks_plan_status",
    {
      description:
        "Where every open task stands in the plan loop: PR needs a fix, merged (complete it), PR closed, agent running, waiting on merge, stopped (resumable), blocked, ready to hand to an agent, drafts to write up.",
      inputSchema: { date: date.optional().describe("Task day (default today)") },
    },
    async ({ date: day }) =>
      withDashboardErrors(async () => {
        const res = await dashboard.get<{ text: string }>("/api/tasks/plan-status", { format: "text", date: day });
        return text(res.text);
      }),
  );

  server.registerTool(
    "tasks_plan_markdown",
    {
      description:
        "A task's plan as one portable markdown document: task, note (plan, acceptance, open questions, context), handoff, and agent runs with their PRs. Use to share a plan or hand it to an agent that can't reach this dashboard.",
      inputSchema: { taskId, date: date.describe("Task day") },
    },
    async ({ taskId: id, date: day }) =>
      withDashboardErrors(async () => {
        const markdown = await dashboard.get<string>("/api/tasks/implement/plan", {
          taskId: id,
          date: day,
          format: "markdown",
        });
        return text(typeof markdown === "string" ? markdown : JSON.stringify(markdown));
      }),
  );

  server.registerTool(
    "tasks_pr_watch",
    {
      description:
        "Check the pull requests that task agent runs opened (normally every 10 minutes). action=check runs a pass now and reports how many need a fix / merged / closed. action=dismiss clears a run's PR alert (CI failing, changes requested, new comments) until the PR changes. To send the agent back to fix it, use tasks_agent_resume — it includes the finding and clears the alert.",
      inputSchema: {
        action: z.enum(["check", "dismiss"]),
        taskId: taskId.optional().describe("Required for dismiss"),
        runId: z.string().trim().max(64).optional().describe("Required for dismiss"),
      },
    },
    async ({ action, taskId: id, runId }) =>
      withDashboardErrors(async () => {
        if (action === "dismiss") {
          if (!id || !runId) return text("dismiss needs taskId and runId.");
          await dashboard.post("/api/tasks/agent-runs/attention", { taskId: id, runId });
          return text(`Dismissed the PR alert on ${runId}.`);
        }
        const res = await dashboard.post<PrWatchResponse>("/api/tasks/pr-watch", {}, 120_000);
        return text(
          `Checked ${res.checked} PR(s): ${res.attention} need a fix, ${res.merged} merged, ${res.closed} closed. ` +
            "See tasks_plan_status for which tasks.",
        );
      }),
  );

  server.registerTool(
    "tasks_alert_drafts",
    {
      description:
        "Read or set whether new firing on-call Datadog alerts become draft tasks (off by default; drafts are never dispatched). Omit enabled to read.",
      inputSchema: { enabled: z.boolean().optional() },
    },
    async ({ enabled }) =>
      withDashboardErrors(async () => {
        const res =
          enabled === undefined
            ? await dashboard.get<{ enabled: boolean }>("/api/tasks/alert-drafts")
            : await dashboard.put<{ enabled: boolean }>("/api/tasks/alert-drafts", { enabled });
        return text(`Alert drafts are ${res.enabled ? "on" : "off"}.`);
      }),
  );

  server.registerTool(
    "tasks_retro_inputs",
    {
      description:
        "Raw material for a plan retro: tasks finished or abandoned in the window (with handoffs, runs and PR outcomes), agent-run outcomes, failing MCP tools, and the shared skill list. Used by the devhub-retro skill.",
      inputSchema: { days: z.number().int().min(1).max(31).optional().describe("Look-back window (default 7)") },
    },
    async ({ days }) =>
      withDashboardErrors(async () => {
        const res = await dashboard.get<unknown>("/api/tasks/retro", { days: days ?? 7 });
        return text(JSON.stringify(res, null, 2));
      }),
  );
}
