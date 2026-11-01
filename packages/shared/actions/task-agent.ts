import { z } from "zod";
import { defineAction } from "./define.ts";

export const taskAgentHandoffGetInput = z.object({
  taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
}).meta({ additionalProperties: false });

export const taskAgentHandoffSetInput = taskAgentHandoffGetInput.extend({
  handoff: z.string().max(100_000).describe("Markdown handoff body"),
  mode: z.enum(["replace", "append"]).optional().describe("replace (default) or append"),
});

export interface TaskAgentHandoffValue {
  taskId: string;
  handoff: string;
  handoffUpdatedAt?: string;
  latestRun: { runId: string; status: string; provider?: string } | null;
}

export type TaskAgentHandoffResult =
  | { ok: true; value: TaskAgentHandoffValue }
  | { ok: false; error: string; status: number };

export interface TaskAgentHandoffReadContext {
  read: (taskId: string) => Promise<TaskAgentHandoffResult>;
}

export interface TaskAgentHandoffWriteContext {
  write: (input: z.output<typeof taskAgentHandoffSetInput>) => Promise<TaskAgentHandoffResult>;
}

export const taskAgentHandoffGet = defineAction<typeof taskAgentHandoffGetInput, TaskAgentHandoffReadContext, TaskAgentHandoffResult>({
  input: taskAgentHandoffGetInput,
  http: { method: "GET", path: "/api/tasks/agent-runs/handoff" },
  mcp: { name: "tasks_agent_handoff_get", toolset: "tasks", description: "Read the durable markdown handoff for a DevHub task (resume: call this before continuing implement-task work). Includes the latest linked agent run when present. Requires the dashboard." },
  handler: ({ taskId }, context) => context.read(taskId),
});

export const taskAgentHandoffSet = defineAction<typeof taskAgentHandoffSetInput, TaskAgentHandoffWriteContext, TaskAgentHandoffResult>({
  input: taskAgentHandoffSetInput,
  http: { method: "PUT", path: "/api/tasks/agent-runs/handoff" },
  mcp: { name: "tasks_agent_handoff_set", toolset: "tasks", description: "Write durable handoff markdown for a DevHub task. Call before pause, end-of-day, or abandon so a later resume can pick up. mode=replace (default) or append. Requires the dashboard." },
  handler: (input, context) => context.write(input),
});

export const taskAgentRunsInput = taskAgentHandoffGetInput.extend({
  runId: z.string().trim().regex(/^run-[a-z0-9]+-[0-9a-f]+$/, "run id from agent_dispatch / agent_runs").optional().describe("When set, upsert this run onto the task"),
  status: z.enum(["queued", "running", "paused", "done", "failed", "abandoned"]).optional().describe("Sidecar status (paused for EOD; abandoned when giving up)"),
  provider: z.string().trim().min(1).max(64).optional().describe("Agent provider id, e.g. claude"),
  prUrl: z.string().url().max(2_000).nullable().optional(),
  branch: z.string().trim().min(1).max(300).nullable().optional(),
  sessionId: z.string().trim().min(1).max(200).nullable().optional(),
  terminalSessionId: z.string().trim().min(1).max(200).nullable().optional(),
  handoff: z.string().max(100_000).optional().describe("Optional handoff markdown to set in the same write"),
  handoffMode: z.enum(["replace", "append"]).optional().describe("How to apply handoff (default replace)"),
});

export interface TaskAgentRunsValue {
  taskId: string;
  handoff: string;
  handoffUpdatedAt: string | null;
  runs: Array<{ runId: string; status: string; provider?: string; branch?: string; prUrl?: string }>;
}

export type TaskAgentRunsResult =
  | { ok: true; value: TaskAgentRunsValue; runId?: string }
  | { ok: false; error: string; status: number };

export interface TaskAgentRunsContext {
  list: (taskId: string) => Promise<TaskAgentRunsResult>;
  upsert: (input: z.output<typeof taskAgentRunsInput> & { runId: string }) => Promise<TaskAgentRunsResult>;
}

export const taskAgentRuns = defineAction<typeof taskAgentRunsInput, TaskAgentRunsContext, TaskAgentRunsResult>({
  input: taskAgentRunsInput,
  http: { method: "POST", path: "/api/tasks/agent-runs" },
  mcp: { name: "tasks_agent_runs", toolset: "tasks", description: "List or upsert agent runs linked to a DevHub task (durable task↔run sidecar + optional handoff). GET-style when only taskId is set; pass runId to link/update a run (status queued|running|paused|done|failed|abandoned). Requires the dashboard. Use before pause/EOD and when starting/resuming implement-task runs." },
  handler: async (input, context) => {
    const result = input.runId ? await context.upsert({ ...input, runId: input.runId }) : await context.list(input.taskId);
    return result.ok ? { ...result, runId: input.runId } : result;
  },
});

export const taskAgentRunsListInput = taskAgentHandoffGetInput.pick({ taskId: true });

export const taskAgentRunsList = defineAction<typeof taskAgentRunsListInput, TaskAgentRunsContext, TaskAgentRunsResult>({
  input: taskAgentRunsListInput,
  http: { method: "GET", path: "/api/tasks/agent-runs" },
  mcp: { reason: "The tasks_agent_runs tool already combines list and upsert." },
  handler: ({ taskId }, context) => context.list(taskId),
});

export const taskAgentResumeInput = taskAgentHandoffGetInput.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").describe("Day file the task lives in"),
  provider: z.string().trim().min(1).max(64).optional().describe("Optional agent_dispatch provider id"),
  model: z.string().trim().max(120).optional(),
  effort: z.string().trim().max(32).optional().describe("Reasoning effort. Omit for the provider default."),
  cwd: z.string().trim().min(1).max(1_000).optional().describe("Checkout path when starting a new run"),
  origin: z.string().url().optional().describe("Dashboard origin for plan URL (defaults to the MCP dashboard base URL)"),
});

export const taskAgentPlanInput = taskAgentResumeInput.extend({
  cwd: z.string().trim().min(1).max(1_000).optional().describe("Checkout to read; defaults to the task's linked repo"),
  origin: z.string().url().optional().describe("Dashboard origin for the plan URL (defaults to the MCP dashboard base URL)"),
});

export interface TaskAgentRunValue {
  id: string;
  state: string;
  providerLabel?: string;
  title?: string;
}

export interface TaskAgentResumeValue {
  mode: "followup" | "new";
  run: TaskAgentRunValue;
  priorRunId: string | null;
  handoffChars: number;
}

export type TaskAgentDispatchResult<Value> =
  | { ok: true; value: Value; taskId?: string }
  | { ok: false; error: string; status: number; body?: Record<string, unknown> };

export interface TaskAgentResumeContext {
  resume: (input: z.output<typeof taskAgentResumeInput>) => Promise<TaskAgentDispatchResult<TaskAgentResumeValue>>;
}

export interface TaskAgentPlanContext {
  plan: (input: z.output<typeof taskAgentPlanInput>) => Promise<TaskAgentDispatchResult<{ run: TaskAgentRunValue }>>;
}

export const taskAgentResume = defineAction<typeof taskAgentResumeInput, TaskAgentResumeContext, TaskAgentDispatchResult<TaskAgentResumeValue>>({
  input: taskAgentResumeInput,
  http: { method: "POST", path: "/api/tasks/agent-runs/resume" },
  mcp: { name: "tasks_agent_resume", toolset: "tasks", description: "Resume a DevHub task's agent work. Prefers follow-up on the latest linked run (same CLI session) injecting durable handoff + implement plan URL; otherwise dispatches a new run quoting the handoff and upserts the task↔run sidecar. Requires the dashboard. Compose manually with tasks_agent_handoff_get + agent_followup / agent_dispatch + tasks_agent_runs when you need finer control." },
  handler: async (input, context) => {
    const result = await context.resume(input);
    return result.ok ? { ...result, taskId: input.taskId } : result;
  },
});

export const taskAgentPlan = defineAction<typeof taskAgentPlanInput, TaskAgentPlanContext, TaskAgentDispatchResult<{ run: TaskAgentRunValue }>>({
  input: taskAgentPlanInput,
  http: { method: "POST", path: "/api/tasks/agent-runs/plan" },
  mcp: { name: "tasks_agent_plan", toolset: "tasks", description: "Start a PLAN-ONLY agent run for a DevHub task: one plan run in the task's linked repo that investigates and writes Plan / Acceptance / Open questions into the task note, then stops. Codex uses a read-only sandbox; Claude uses plan permissions. Other providers use planning mode where available, otherwise instructions only: repository writes are not guaranteed to be blocked. The injected MCP peer can only update this task's plan sections. It never starts auto mode or continues to implement; use storyboard_start_auto for plan-then-build, or tasks_agent_resume to implement. Refuses a closed task, a task on auto, or one whose latest run is still active. Requires the dashboard." },
  handler: async (input, context) => {
    const result = await context.plan(input);
    return result.ok ? { ...result, taskId: input.taskId } : result;
  },
});

export const taskReviewSettingsGetInput = z.object({}).meta({ additionalProperties: false });
export const taskReviewSettingsSetInput = z.object({
  provider: z.string().trim().max(64).optional().describe("Provider id from agent_providers, e.g. codex. Empty string clears the reviewer."),
  model: z.string().trim().max(120).optional().describe("Provider-specific model id; omit for the provider's default."),
  effort: z.string().trim().max(32).optional().describe("Reasoning effort. Empty string clears it."),
}).meta({ additionalProperties: false });

export interface TaskReviewSettingsValue {
  provider: string;
  model: string;
  effort?: string;
}

export interface TaskReviewSettingsReadContext {
  read: () => Promise<TaskAgentDispatchResult<TaskReviewSettingsValue>>;
}

export interface TaskReviewSettingsWriteContext {
  save: (input: z.output<typeof taskReviewSettingsSetInput>) => Promise<TaskAgentDispatchResult<TaskReviewSettingsValue>>;
}

export const taskReviewSettingsGet = defineAction<typeof taskReviewSettingsGetInput, TaskReviewSettingsReadContext, TaskAgentDispatchResult<TaskReviewSettingsValue>>({
  input: taskReviewSettingsGetInput,
  http: { method: "GET", path: "/api/tasks/implement/review-settings" },
  mcp: { name: "tasks_implement_review_settings_get", toolset: "tasks", description: "Read which assistant reviews a finished implementation before it asks to commit (provider + model). Blank provider means the implementing agent reviews its own diff. Stored in notes/.config/implement-review.json. Requires the dashboard running." },
  handler: (_input, context) => context.read(),
});

export const taskReviewSettingsSet = defineAction<typeof taskReviewSettingsSetInput, TaskReviewSettingsWriteContext, TaskAgentDispatchResult<TaskReviewSettingsValue>>({
  input: taskReviewSettingsSetInput,
  http: { method: "PUT", path: "/api/tasks/implement/review-settings" },
  mcp: { name: "tasks_implement_review_settings_set", toolset: "tasks", description: "Assign the assistant that reviews a finished implementation (provider id from agent_providers, optional model). An empty provider switches back to the implementing agent reviewing its own diff. Changing the provider clears the model unless you pass one. Applies to implement runs that start afterwards. Requires the dashboard running." },
  handler: (input, context) => input.provider === undefined && input.model === undefined && input.effort === undefined
    ? { ok: false, error: "Provide provider, model, effort, or a combination.", status: 400 }
    : context.save(input),
});

export const taskImplementReadyInput = taskAgentHandoffGetInput.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional().describe("Day file the task lives in (defaults to today on the dashboard)"),
  selectedRepoId: z.string().trim().min(1).max(200).optional().describe("When multiple kind:repo links exist, the repo to use"),
  hubRepoId: z.string().trim().min(1).max(200).optional().describe("Hub checkout owner/repo — satisfies repo when the task has no repo links"),
  hardBlock: z.boolean().optional().describe("Override vault prefs; true refuses ready when items fail"),
});

export interface TaskImplementReadyValue {
  taskId: string;
  date: string;
  ok: boolean;
  warn: boolean;
  blocked: boolean;
  hardBlock: boolean;
  selectedRepoId: string | null;
  items: Array<{ id: string; ok: boolean; label: string; detail?: string; fixHref?: string; fixLabel?: string }>;
}

export interface TaskImplementReadyContext {
  check: (input: z.output<typeof taskImplementReadyInput>) => Promise<TaskAgentDispatchResult<TaskImplementReadyValue>>;
}

export const taskImplementReady = defineAction<typeof taskImplementReadyInput, TaskImplementReadyContext, TaskAgentDispatchResult<TaskImplementReadyValue>>({
  input: taskImplementReadyInput,
  http: { method: "GET", path: "/api/tasks/implement/ready" },
  mcp: { name: "tasks_implement_ready", toolset: "tasks", description: "Light ready-to-implement checklist for a DevHub task (acceptance/plan, single repo link or pick, no open #prerequisite/#blocker). Warn by default; hardBlock (prefs or arg) flips to blocked. Proxies GET /api/tasks/implement/ready. Call before agent_dispatch / Implement." },
  handler: (input, context) => context.check(input),
});

export const taskImplementReviewInput = taskAgentHandoffGetInput.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").describe("Day file the task lives in"),
  cwd: z.string().trim().min(1).max(1_000).describe("Absolute path of the checkout or worktree holding the implementation"),
  notePath: z.string().trim().min(1).max(300).describe("Where the review note is saved, under pr-reviews/, e.g. pr-reviews/payments-api-pay-482"),
  branch: z.string().trim().min(1).max(200).optional().describe("Implementation branch"),
  base: z.string().trim().min(1).max(200).optional().describe("Intended remote base, e.g. origin/main"),
  origin: z.string().url().optional().describe("Dashboard origin for the plan URL (defaults to the MCP dashboard base URL)"),
});

export interface TaskImplementReviewValue {
  run: TaskAgentRunValue;
  reviewer: { provider: string; model: string | null; effort?: string };
  notePath: string;
}

export interface TaskImplementReviewContext {
  review: (input: z.output<typeof taskImplementReviewInput>) => Promise<TaskAgentDispatchResult<TaskImplementReviewValue>>;
}

export const taskImplementReview = defineAction<typeof taskImplementReviewInput, TaskImplementReviewContext, TaskAgentDispatchResult<TaskImplementReviewValue>>({
  input: taskImplementReviewInput,
  http: { method: "POST", path: "/api/tasks/implement/review" },
  mcp: { name: "tasks_implement_review", toolset: "tasks", description: "Start the assistant assigned as reviewer (see tasks_implement_review_settings_get) on your implementation checkout. It reviews read-only with the pr-explain-review skill, saves the review as the note at notePath, and replies with a verdict and must-fix list. Returns a run id: agent_wait on it, then notes_read the note. Use only when the plan payload's `reviewer` is set; errors with no_reviewer otherwise, in which case review your own diff. A review run cannot start another review. Requires the dashboard." },
  handler: (input, context) => context.review(input),
});
