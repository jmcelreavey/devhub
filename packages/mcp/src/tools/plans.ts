/**
 * The plan loop: capture an idea as a draft, write it up, mark it ready, watch
 * the PR the agent opens, and learn from what finished. Dashboard-backed.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { taskCapture, taskPlanMarkdown, taskPlanStatus, taskPrWatch, taskRetroInputs, taskSetStage } from "../../../../packages/shared/actions/plans.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";

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

  registerAction(
    server, taskCapture,
    { capture: (input) => dashboard.post<CaptureResponse>("/api/tasks/capture", input) },
    (value) => {
      const result = value as CaptureResponse;
      const context = result.context;
      return text(
        `Captured draft ${result.task.id} on ${result.date}: ${result.task.text}\n` +
          `Note: ${result.notePath}\n` +
          `Context: ${context.notes.length} note(s), ${context.prs.length} PR(s), ${context.tasks.length} earlier task(s), ${context.alerts.length} alert(s).`,
      );
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, taskSetStage,
    { setStage: async (input) => ({ status: 200, body: await dashboard.post<{ id: string; text: string; stage?: string }>("/api/tasks/stage", input) }) },
    ({ body }) => {
      const task = body as { id: string; text: string; stage?: string };
      return text(`Task ${task.id} is now ${task.stage ?? "ready"}: ${task.text}`);
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, taskPlanStatus,
    { read: (day) => dashboard.get<{ text: string }>("/api/tasks/plan-status", { format: "text", date: day }) },
    (result) => text((result as { text: string }).text),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, taskPlanMarkdown,
    { read: ({ taskId, date }) => dashboard.get<string>("/api/tasks/implement/plan", { taskId, date, format: "markdown" }) },
    (markdown) => text(typeof markdown === "string" ? markdown : JSON.stringify(markdown)),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, taskPrWatch,
    {
      check: () => dashboard.post<PrWatchResponse>("/api/tasks/pr-watch", {}, 120_000),
      dismiss: async (taskId, runId) => { await dashboard.post("/api/tasks/agent-runs/attention", { taskId, runId }); },
    },
    (result) => {
      if (result.kind === "missing") return text("dismiss needs taskId and runId.");
      if (result.kind === "dismissed") return text(`Dismissed the PR alert on ${result.runId}.`);
      const report = result.report;
      return text(
        `Checked ${report.checked} PR(s): ${report.attention} need a fix, ${report.merged} merged, ${report.closed} closed. ` +
          "See tasks_plan_status for which tasks.",
      );
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, taskRetroInputs,
    { read: (days) => dashboard.get<unknown>("/api/tasks/retro", { days: days ?? 7 }) },
    (result) => text(JSON.stringify(result)),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );
}
