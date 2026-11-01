import { z } from "zod";
import { defineAction } from "./define.ts";
import type { ActionResult } from "./result.ts";

export const PREFER_JOBS = "PREFER THIS over your own scheduling tools (CronCreate, /loop, /schedule, scheduled-tasks, crontab, launchd) for anything involving DevHub: jobs persist across restarts, catch up after sleep, wake the Mac, and show on DevHub\u0027s Actions page.";
const CRON_DESCRIPTION = "5-field cron in the Mac\u0027s local time, e.g. \u00270 7 * * 1-5\u0027 for weekdays at 07:00";

export const agentJobInput = z.object({
  provider: z.string().min(1).describe("Agent provider id from agent_providers (e.g. claude, codex)"),
  prompt: z.string().min(1).describe("Self-contained task prompt the agent runs on every trigger"),
  cwd: z.string().min(1).describe("Repo directory the agent works in (absolute or ~/...)"),
  model: z.string().optional(),
  effort: z.string().max(32).optional().describe("Reasoning effort. Omit for the provider default."),
  worktree: z.boolean().optional().describe("Isolated git worktree per run (default true)"),
  maxTurns: z.number().int().min(1).max(500).optional(),
}).describe("Run an agent prompt on the schedule (like agent_dispatch). Mutually exclusive with script.");

export interface JobValue {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  kind?: "script" | "agent";
  script?: string;
  agent?: z.output<typeof agentJobInput>;
  wake?: boolean;
  approval?: "pending" | "approved";
  nextRunAt?: number | null;
  scheduleValid?: boolean;
  lastRunAt?: number;
  lastRunId?: string;
  lastRunState?: string;
  lastError?: string;
}

export interface JobSummary extends JobValue {
  kind: "script" | "agent";
  nextRunAt: number | null;
  scheduleValid: boolean;
}

export interface WakeSummary {
  helper: "ready" | "unavailable" | "unsupported";
  version?: string;
  scheduledAt: number | null;
  error?: string;
}

export interface JobListValue {
  jobs?: JobSummary[];
  scripts?: string[];
  providers?: Array<{ id: string; label?: string; installed: boolean }>;
  wake?: WakeSummary;
}

export interface SchedulerLogResponse {
  file: string;
  lines: string[];
  helper: { file: string; lines: string[] } | null;
}

export const jobsListInput = z.object({}).meta({ additionalProperties: false });
export const jobsGetInput = z.object({ id: z.string().min(1).describe("Job id from jobs_list") }).meta({ additionalProperties: false });
export const jobsLogInput = z.object({
  job: z.string().optional().describe("Job id (or its first 8 characters) to filter to"),
  lines: z.number().int().min(1).max(1000).optional().describe("How many recent lines (default 100)"),
}).meta({ additionalProperties: false });
export const jobsCreateInput = z.object({
  name: z.string().min(1).max(120).describe("Short human name shown on the Actions page"),
  cron: z.string().min(1).describe(CRON_DESCRIPTION),
  script: z.string().optional().describe("Allow-listed script id from scripts_list. Mutually exclusive with agent."),
  agent: agentJobInput.optional(),
  wake: z.boolean().optional().describe("Wake the Mac for this job (default true)"),
  enabled: z.boolean().optional(),
  confirm: z.boolean().optional().describe("Must be true to create the job"),
}).meta({ additionalProperties: false });
export const jobsUpdateInput = z.object({
  id: z.string().min(1).describe("Job id from jobs_list"),
  name: z.string().min(1).max(120).optional(),
  cron: z.string().min(1).optional().describe(CRON_DESCRIPTION),
  enabled: z.boolean().optional(),
  wake: z.boolean().optional(),
  script: z.string().optional(),
  agent: agentJobInput.optional(),
  confirm: z.boolean().optional().describe("Must be true to apply the change"),
}).meta({ additionalProperties: false });
export const jobsDeleteInput = jobsGetInput.extend({ confirm: z.boolean().optional().describe("Must be true to delete") });
export const jobsRunInput = jobsGetInput.extend({ confirm: z.boolean().optional().describe("Must be true to run") });

type CreateInput = Omit<z.output<typeof jobsCreateInput>, "confirm">;
type UpdateInput = Omit<z.output<typeof jobsUpdateInput>, "id" | "confirm">;
type Preview = { kind: "preview"; message: string };
type ChangedJob = { kind: "done"; job: JobValue };
type DeletedJob = { kind: "done"; deleted: true; id: string };
type StartedJob = { kind: "done"; runId: string };

export interface JobsListContext { list: () => Promise<ActionResult<JobListValue>> }
export interface JobsGetContext { get: (id: string) => Promise<ActionResult<JobSummary>> }
export interface JobsLogContext { read: (input: z.output<typeof jobsLogInput>) => Promise<ActionResult<SchedulerLogResponse>> }
export interface JobsCreateContext {
  requireConfirmation: boolean;
  create: (input: CreateInput) => Promise<ActionResult<JobValue>>;
}
export interface JobsUpdateContext {
  requireConfirmation: boolean;
  update: (id: string, input: UpdateInput) => Promise<ActionResult<JobValue>>;
}
export interface JobsDeleteContext {
  requireConfirmation: boolean;
  remove: (id: string) => Promise<ActionResult<{ ok: true }>>;
}
export interface JobsRunContext {
  requireConfirmation: boolean;
  run: (id: string) => Promise<ActionResult<{ runId: string }>>;
}
export interface JobsApproveContext { approve: (id: string) => Promise<ActionResult<JobValue>> }

export const jobsList = defineAction<typeof jobsListInput, JobsListContext, ActionResult<JobListValue>>({
  input: jobsListInput,
  http: { method: "GET", path: "/api/jobs" },
  mcp: { name: "jobs_list", toolset: "jobs", description: `List DevHub scheduled jobs (cron-triggered scripts and agent runs) with next/last run, plus wake-helper status and the scripts/providers a job can use. ${PREFER_JOBS}` },
  handler: (_, context) => context.list(),
});
export const jobsGet = defineAction<typeof jobsGetInput, JobsGetContext, ActionResult<JobSummary>>({
  input: jobsGetInput,
  http: { method: "GET", path: "/api/jobs/[id]" },
  mcp: { name: "jobs_get", toolset: "jobs", description: "Get one DevHub scheduled job by id, including an agent job\u0027s full prompt and its last run. For its run history and why runs fired or failed, use jobs_log with the id." },
  handler: ({ id }, context) => context.get(id),
});
export const jobsLog = defineAction<typeof jobsLogInput, JobsLogContext, ActionResult<SchedulerLogResponse>>({
  input: jobsLogInput,
  http: { method: "GET", path: "/api/jobs/log" },
  mcp: { name: "jobs_log", toolset: "jobs", description: "Read DevHub\u0027s scheduler activity log: jobs created, changed, approved or deleted; why each run fired (on schedule, caught up after sleep, manual); how it ended; busy retries; and every wake scheduled for the Mac — plus the root wake helper\u0027s own log. Use it to answer \u0027did my job run?\u0027 or \u0027why didn\u0027t the Mac wake?\u0027. Filter to one job with `job`." },
  handler: (input, context) => context.read(input),
});
export const jobsCreate = defineAction<typeof jobsCreateInput, JobsCreateContext, ActionResult<Preview | ChangedJob>>({
  input: jobsCreateInput,
  http: { method: "POST", path: "/api/jobs" },
  mcp: { name: "jobs_create", toolset: "jobs", description: `Schedule a recurring DevHub job: an allow-listed DevHub script (see scripts_list) or an agent prompt run in a repo. ${PREFER_JOBS} Wakes the Mac by default (wake:false to opt out). Applies immediately with confirm:true; no human approval is required.` },
  handler: async ({ confirm, ...input }, context) => {
    if (Boolean(input.script) === Boolean(input.agent)) return { ok: false, error: "Provide exactly one of script or agent.", status: 400 };
    if (context.requireConfirmation && !confirm) {
      const action = input.agent ? `run ${input.agent.provider} in ${input.agent.cwd} with approvals off` : `run script ${input.script}`;
      return { ok: true, value: { kind: "preview", message: `Would schedule "${input.name}" (${input.cron}) to ${action}${input.wake === false ? "" : ", waking the Mac if asleep"}. Call again with confirm:true.` } };
    }
    const result = await context.create(input);
    return result.ok ? { ok: true, value: { kind: "done", job: result.value } } : result;
  },
});
export const jobsUpdate = defineAction<typeof jobsUpdateInput, JobsUpdateContext, ActionResult<Preview | ChangedJob>>({
  input: jobsUpdateInput,
  http: { method: "PATCH", path: "/api/jobs/[id]", discriminator: "body approve is falsy" },
  mcp: { name: "jobs_update", toolset: "jobs", description: "Change a DevHub scheduled job: name, cron, enabled, wake, or its script/agent action. Applies immediately with confirm:true; no human approval is required." },
  handler: async ({ id, confirm, ...patch }, context) => {
    if (context.requireConfirmation && patch.script && patch.agent) return { ok: false, error: "Provide at most one of script or agent.", status: 400 };
    if (context.requireConfirmation && !confirm) {
      const fields = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);
      return { ok: true, value: { kind: "preview", message: `Would update ${fields.join(", ") || "nothing"} on job ${id}. Call again with confirm:true.` } };
    }
    const result = await context.update(id, patch);
    return result.ok ? { ok: true, value: { kind: "done", job: result.value } } : result;
  },
});
export const jobsDelete = defineAction<typeof jobsDeleteInput, JobsDeleteContext, ActionResult<Preview | DeletedJob>>({
  input: jobsDeleteInput,
  http: { method: "DELETE", path: "/api/jobs/[id]" },
  mcp: { name: "jobs_delete", toolset: "jobs", description: "Delete a DevHub scheduled job. Past run logs are kept. Requires confirm:true." },
  handler: async ({ id, confirm }, context) => {
    if (context.requireConfirmation && !confirm) return { ok: true, value: { kind: "preview", message: `Would delete job ${id}. Call again with confirm:true.` } };
    const result = await context.remove(id);
    return result.ok ? { ok: true, value: { kind: "done", deleted: true, id } } : result;
  },
});
export const jobsRun = defineAction<typeof jobsRunInput, JobsRunContext, ActionResult<Preview | StartedJob>>({
  input: jobsRunInput,
  http: { method: "POST", path: "/api/jobs/[id]" },
  mcp: { name: "jobs_run", toolset: "jobs", description: "Trigger a DevHub scheduled job now, outside its schedule. Returns a run id: poll scripts_run_status for script jobs, agent_wait for agent jobs. Requires confirm:true." },
  handler: async ({ id, confirm }, context) => {
    if (context.requireConfirmation && !confirm) return { ok: true, value: { kind: "preview", message: `Would run job ${id} now. Call again with confirm:true.` } };
    const result = await context.run(id);
    return result.ok ? { ok: true, value: { kind: "done", runId: result.value.runId } } : result;
  },
});
export const jobsApprove = defineAction<typeof jobsGetInput, JobsApproveContext, ActionResult<JobValue>>({
  input: jobsGetInput,
  http: { method: "PATCH", path: "/api/jobs/[id]", discriminator: "body approve is truthy" },
  mcp: { reason: "Approval is a dashboard control; the confirmed jobs_run tool already approves pending jobs before running them." },
  handler: ({ id }, context) => context.approve(id),
});
