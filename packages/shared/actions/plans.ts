import { z } from "zod";
import { defineAction } from "./define.ts";

export const taskSetStageInput = z.object({
  taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").describe("Task day"),
  stage: z.enum(["draft", "ready"]),
  force: z.boolean().optional().describe("Mark ready despite checklist gaps — only when the user says so"),
}).meta({ additionalProperties: false });

export const taskSetStageBodyInput = taskSetStageInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export interface TaskSetStageContext {
  setStage: (input: z.output<typeof taskSetStageInput>) => Promise<{ status: number; body: unknown }>;
}

export const taskSetStage = defineAction<typeof taskSetStageInput, TaskSetStageContext, { status: number; body: unknown }>({
  input: taskSetStageInput,
  http: { method: "POST", path: "/api/tasks/stage" },
  mcp: {
    name: "tasks_set_stage", toolset: "tasks",
    description: "Move a task between draft and ready. 'ready' runs the implement checklist (plan/acceptance written, no unanswered ## Open questions, one repo linked, no open prerequisites) and fails listing the gaps unless force is true. Use at the end of a plan-writing pass.",
  },
  handler: (input, context) => context.setStage(input),
});

export const taskPlanStatusInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional().describe("Task day (default today)"),
}).meta({ additionalProperties: false });

export interface TaskPlanStatusContext {
  read: (date?: string) => Promise<unknown> | unknown;
}

export const taskPlanStatus = defineAction<typeof taskPlanStatusInput, TaskPlanStatusContext, unknown>({
  input: taskPlanStatusInput,
  http: { method: "GET", path: "/api/tasks/plan-status" },
  mcp: {
    name: "tasks_plan_status", toolset: "tasks",
    description: "Where every open task stands in the plan loop: PR needs a fix, merged (complete it), PR closed, agent running, waiting on merge, stopped (resumable), blocked, ready to hand to an agent, drafts to write up.",
  },
  handler: ({ date }, context) => context.read(date),
});

export const taskCaptureInput = z.object({
  text: z.string().trim().min(1).max(500).describe("One-line task title"),
  detail: z.string().max(10_000).optional().describe("Longer description, e.g. the Slack message or alert text"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional().describe("Task day (default today)"),
}).meta({ additionalProperties: false });

export interface TaskCaptureContext {
  capture: (input: z.output<typeof taskCaptureInput>) => Promise<unknown>;
}

export const taskCapture = defineAction<typeof taskCaptureInput, TaskCaptureContext, unknown>({
  input: taskCaptureInput,
  http: { method: "POST", path: "/api/tasks/capture" },
  mcp: {
    name: "tasks_capture", toolset: "tasks",
    description: "Capture an idea as a DRAFT task (not ready for an agent yet). Saves a context snapshot — related notes, PRs, earlier tasks, recent alerts — into the task note under ## Context snapshot, plus an empty ## Open questions. Use for anything you or the user want to remember to look at later.",
  },
  handler: (input, context) => context.capture(input),
});

export const taskPlanMarkdownInput = z.object({
  taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").describe("Task day"),
}).meta({ additionalProperties: false });

export interface TaskPlanMarkdownContext {
  read: (input: z.output<typeof taskPlanMarkdownInput>) => string | Promise<string>;
}

export const taskPlanMarkdown = defineAction<typeof taskPlanMarkdownInput, TaskPlanMarkdownContext, string>({
  input: taskPlanMarkdownInput,
  http: { method: "GET", path: "/api/tasks/implement/plan" },
  mcp: {
    name: "tasks_plan_markdown", toolset: "tasks",
    description: "A task's plan as one portable markdown document: task, note (plan, acceptance, open questions, context), handoff, and agent runs with their PRs. Use to share a plan or hand it to an agent that can't reach this dashboard.",
  },
  handler: (input, context) => context.read(input),
});

export const taskPrWatchInput = z.object({
  action: z.enum(["check", "dismiss"]),
  taskId: z.string().trim().min(1).max(128).optional().describe("Required for dismiss"),
  runId: z.string().trim().max(64).optional().describe("Required for dismiss"),
}).meta({ additionalProperties: false });

export interface PlanPrWatchReport {
  checked: number;
  attention: number;
  merged: number;
  closed: number;
}

export interface TaskPrWatchContext {
  check: () => Promise<PlanPrWatchReport>;
  dismiss: (taskId: string, runId: string) => Promise<void>;
}

export type PlanPrWatchResult =
  | { kind: "missing" }
  | { kind: "dismissed"; runId: string }
  | { kind: "checked"; report: PlanPrWatchReport };

export const taskPrWatch = defineAction<typeof taskPrWatchInput, TaskPrWatchContext, PlanPrWatchResult>({
  input: taskPrWatchInput,
  http: { method: "POST", path: "/api/tasks/pr-watch" },
  mcp: {
    name: "tasks_pr_watch", toolset: "tasks",
    description: "Check the pull requests that task agent runs opened (normally every 10 minutes). action=check runs a pass now and reports how many need a fix / merged / closed. action=dismiss clears a run's PR alert (CI failing, changes requested, new comments) until the PR changes. To send the agent back to fix it, use tasks_agent_resume — it includes the finding and clears the alert.",
  },
  handler: async ({ action, taskId, runId }, context) => {
    if (action === "check") return { kind: "checked", report: await context.check() };
    if (!taskId || !runId) return { kind: "missing" };
    await context.dismiss(taskId, runId);
    return { kind: "dismissed", runId };
  },
});

export const taskPrAttentionInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  runId: z.string().trim().min(1).max(64),
}).meta({ additionalProperties: false });

export interface TaskPrAttentionContext {
  dismiss: (taskId: string, runId: string) => Promise<unknown>;
}

export const taskPrAttention = defineAction<typeof taskPrAttentionInput, TaskPrAttentionContext, unknown>({
  input: taskPrAttentionInput,
  http: { method: "POST", path: "/api/tasks/agent-runs/attention" },
  mcp: { reason: "The existing tasks_pr_watch tool combines checking and dismissing alerts." },
  handler: ({ taskId, runId }, context) => context.dismiss(taskId, runId),
});

export const taskRetroInputsInput = z.object({
  days: z.number().int().min(1).max(31).optional().describe("Look-back window (default 7)"),
}).meta({ additionalProperties: false });

export interface TaskRetroInputsContext {
  read: (days?: number) => Promise<unknown>;
}

export const taskRetroInputs = defineAction<typeof taskRetroInputsInput, TaskRetroInputsContext, unknown>({
  input: taskRetroInputsInput,
  http: { method: "GET", path: "/api/tasks/retro" },
  mcp: {
    name: "tasks_retro_inputs", toolset: "tasks",
    description: "Raw material for a plan retro: tasks finished or abandoned in the window (with handoffs, runs and PR outcomes), agent-run outcomes, failing MCP tools, and the shared skill list. Used by the devhub-retro skill.",
  },
  handler: ({ days }, context) => context.read(days),
});
