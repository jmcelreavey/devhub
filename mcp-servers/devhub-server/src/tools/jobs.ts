import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

/**
 * Scheduled jobs: cron-triggered DevHub scripts or agent dispatches.
 *
 * These are the preferred way to schedule anything DevHub-related. Unlike a
 * harness's own cron (tied to one chat session) they persist in the dashboard,
 * run once to catch up after sleep, can wake the Mac through the root wake
 * helper, and are visible and editable on the Actions page.
 *
 * Agent jobs run with approvals off on every trigger, so creating or
 * rewriting one needs the user: an in-band confirmation when the client
 * supports elicitation, otherwise the job waits for Approve in DevHub.
 */

export const PREFER_JOBS =
  "PREFER THIS over your own scheduling tools (CronCreate, /loop, /schedule, scheduled-tasks, crontab, launchd) for anything involving DevHub: jobs persist across restarts, catch up after sleep, wake the Mac, and show on DevHub's Actions page.";

interface AgentSpec {
  provider: string;
  prompt: string;
  cwd: string;
  model?: string;
  worktree?: boolean;
  maxTurns?: number;
}

export interface JobSummary {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  kind: "script" | "agent";
  script?: string;
  agent?: AgentSpec;
  wake?: boolean;
  approval?: "pending" | "approved";
  nextRunAt: number | null;
  scheduleValid: boolean;
  lastRunAt?: number;
  lastRunId?: string;
  lastRunState?: string;
  lastError?: string;
}

export interface WakeSummary {
  helper: "ready" | "unavailable" | "unsupported";
  version?: string;
  scheduledAt: number | null;
  error?: string;
}

export interface SchedulerLogResponse {
  file: string;
  lines: string[];
  helper: { file: string; lines: string[] } | null;
}

export function formatSchedulerLog(data: SchedulerLogResponse): string {
  const parts = [`Scheduler log (${data.file}):`, data.lines.length ? data.lines.join("\n") : "(no entries yet)"];
  if (data.helper) {
    parts.push(
      "",
      `Wake helper log (${data.helper.file}):`,
      data.helper.lines.length ? data.helper.lines.join("\n") : "(empty or unreadable — is the wake helper installed?)",
    );
  }
  return parts.join("\n");
}

function when(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export function formatJob(job: JobSummary, full = false): string {
  const action = job.kind === "agent" && job.agent ? `agent ${job.agent.provider} in ${job.agent.cwd}` : `script ${job.script}`;
  const flags = [
    job.enabled ? "enabled" : "disabled",
    job.wake ? "wakes Mac" : null,
    job.approval === "pending" ? "WAITING FOR APPROVAL in DevHub" : null,
    job.scheduleValid ? null : "invalid cron",
  ].filter(Boolean);
  const lines = [
    `- ${job.name} (${job.id})`,
    `  ${job.cron} · ${action} · ${flags.join(", ")}`,
    `  next ${when(job.nextRunAt)} · last ${when(job.lastRunAt)}${job.lastRunState ? ` (${job.lastRunState})` : ""}${job.lastRunId ? ` run ${job.lastRunId}` : ""}`,
  ];
  if (job.lastError) lines.push(`  last error: ${job.lastError}`);
  if (full && job.agent) lines.push(`  prompt:\n${job.agent.prompt.replace(/^/gm, "    ")}`);
  return lines.join("\n");
}

export function formatWake(wake: WakeSummary | undefined): string {
  if (!wake || wake.helper === "unsupported") return "Wake: not supported on this platform.";
  if (wake.helper === "unavailable") {
    return "Wake: helper NOT installed — jobs only run while the Mac is awake. The user can enable it on DevHub → Actions → Scheduled Jobs.";
  }
  const scheduled = wake.scheduledAt ? `next wake ${when(wake.scheduledAt)}` : "no wake scheduled";
  return `Wake: helper ${wake.version ?? "?"} ready, ${scheduled}${wake.error ? ` (error: ${wake.error})` : ""}.`;
}

export function buildJobConsentRequest(input: { name: string; cron: string; agent: AgentSpec }): {
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, { type: "boolean"; title: string; description: string }>;
    required: string[];
  };
} {
  const prompt = input.agent.prompt.slice(0, 400) + (input.agent.prompt.length > 400 ? "…" : "");
  return {
    message: `Schedule "${input.name}" (${input.cron})?\n\n${input.agent.provider} will run with approvals OFF in ${input.agent.cwd} on every trigger:\n\n${prompt}`,
    requestedSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          title: "Schedule it",
          description: "true = let this agent job run on its schedule without further approval",
        },
      },
      required: ["confirm"],
    },
  };
}

const AgentInput = z
  .object({
    provider: z.string().min(1).describe("Agent provider id from agent_providers (e.g. claude, codex)"),
    prompt: z.string().min(1).describe("Self-contained task prompt the agent runs on every trigger"),
    cwd: z.string().min(1).describe("Repo directory the agent works in (absolute or ~/...)"),
    model: z.string().optional(),
    worktree: z.boolean().optional().describe("Isolated git worktree per run (default true)"),
    maxTurns: z.number().int().min(1).max(500).optional(),
  })
  .describe("Run an agent prompt on the schedule (like agent_dispatch). Mutually exclusive with script.");

const CRON_DESCRIPTION = "5-field cron in the Mac's local time, e.g. '0 7 * * 1-5' for weekdays at 07:00";

export function registerJobsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  /** In-band confirmation: true accepted, false declined, null when the client cannot ask. */
  async function askUser(request: ReturnType<typeof buildJobConsentRequest>): Promise<boolean | null> {
    const caps = server.server.getClientCapabilities() as { elicitation?: unknown } | undefined;
    if (!caps?.elicitation) return null;
    const result = await server.server.elicitInput(request);
    return result.action === "accept" && result.content?.confirm === true;
  }

  server.registerTool(
    "jobs_list",
    {
      description: `List DevHub scheduled jobs (cron-triggered scripts and agent runs) with next/last run, plus wake-helper status and the scripts/providers a job can use. ${PREFER_JOBS}`,
      inputSchema: {},
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          jobs: JobSummary[];
          scripts: string[];
          providers: Array<{ id: string; installed: boolean }>;
          wake: WakeSummary;
        }>("/api/jobs");
        const text = [
          formatWake(data.wake),
          "",
          data.jobs.length ? data.jobs.map((j) => formatJob(j)).join("\n") : "No scheduled jobs.",
          "",
          `Scripts: ${data.scripts.join(", ")}`,
          `Agent providers: ${data.providers.filter((p) => p.installed).map((p) => p.id).join(", ") || "none installed"}`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }),
  );

  server.registerTool(
    "jobs_get",
    {
      description:
        "Get one DevHub scheduled job by id, including an agent job's full prompt and its last run. For its run history and why runs fired or failed, use jobs_log with the id.",
      inputSchema: { id: z.string().min(1).describe("Job id from jobs_list") },
    },
    async ({ id }) =>
      withDashboardErrors(async () => {
        const job = await dashboard.get<JobSummary>(`/api/jobs/${encodeURIComponent(id)}`);
        return { content: [{ type: "text", text: formatJob(job, true) }] };
      }),
  );

  server.registerTool(
    "jobs_log",
    {
      description:
        "Read DevHub's scheduler activity log: jobs created, changed, approved or deleted; why each run fired (on schedule, caught up after sleep, manual); how it ended; busy retries; and every wake scheduled for the Mac — plus the root wake helper's own log. Use it to answer 'did my job run?' or 'why didn't the Mac wake?'. Filter to one job with `job`.",
      inputSchema: {
        job: z.string().optional().describe("Job id (or its first 8 characters) to filter to"),
        lines: z.number().int().min(1).max(1000).optional().describe("How many recent lines (default 100)"),
      },
    },
    async ({ job, lines }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<SchedulerLogResponse>("/api/jobs/log", { job, lines: lines ?? 100 });
        return { content: [{ type: "text", text: formatSchedulerLog(data) }] };
      }),
  );

  server.registerTool(
    "jobs_create",
    {
      description: `Schedule a recurring DevHub job: an allow-listed DevHub script (see scripts_list) or an agent prompt run in a repo. ${PREFER_JOBS} Wakes the Mac by default (wake:false to opt out). Agent jobs run with approvals off, so the user confirms in chat or approves in DevHub before the first run. Requires confirm:true.`,
      inputSchema: {
        name: z.string().min(1).max(120).describe("Short human name shown on the Actions page"),
        cron: z.string().min(1).describe(CRON_DESCRIPTION),
        script: z.string().optional().describe("Allow-listed script id from scripts_list. Mutually exclusive with agent."),
        agent: AgentInput.optional(),
        wake: z.boolean().optional().describe("Wake the Mac for this job (default true)"),
        enabled: z.boolean().optional(),
        confirm: z.boolean().optional().describe("Must be true to create the job"),
      },
    },
    async ({ name, cron, script, agent, wake, enabled, confirm }) =>
      withDashboardErrors(async () => {
        if (Boolean(script) === Boolean(agent)) {
          return { content: [{ type: "text", text: "Provide exactly one of script or agent." }], isError: true };
        }
        const action = agent ? `run ${agent.provider} in ${agent.cwd} with approvals off` : `run script ${script}`;
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: `Would schedule "${name}" (${cron}) to ${action}${wake === false ? "" : ", waking the Mac if asleep"}. Call again with confirm:true.`,
              },
            ],
          };
        }
        const accepted = agent ? await askUser(buildJobConsentRequest({ name, cron, agent })) : null;
        if (accepted === false) {
          return { content: [{ type: "text", text: "The user declined — no job was created." }] };
        }
        const job = await dashboard.post<JobSummary>("/api/jobs", {
          name,
          cron,
          script,
          agent,
          wake,
          enabled,
          source: "mcp",
          confirmed: accepted === true,
        });
        const lines = [`Created job ${job.id}.`];
        if (job.approval === "pending") {
          lines.push(
            "It will NOT run until the user clicks Approve on DevHub → Actions → Scheduled Jobs. Tell them; do not assume approval.",
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }),
  );

  server.registerTool(
    "jobs_update",
    {
      description:
        "Change a DevHub scheduled job: name, cron, enabled, wake, or its script/agent action. Changing an agent job's action sends it back for user approval unless they confirm in chat. Requires confirm:true.",
      inputSchema: {
        id: z.string().min(1).describe("Job id from jobs_list"),
        name: z.string().min(1).max(120).optional(),
        cron: z.string().min(1).optional().describe(CRON_DESCRIPTION),
        enabled: z.boolean().optional(),
        wake: z.boolean().optional(),
        script: z.string().optional(),
        agent: AgentInput.optional(),
        confirm: z.boolean().optional().describe("Must be true to apply the change"),
      },
    },
    async ({ id, confirm, ...patch }) =>
      withDashboardErrors(async () => {
        if (patch.script && patch.agent) {
          return { content: [{ type: "text", text: "Provide at most one of script or agent." }], isError: true };
        }
        if (!confirm) {
          const fields = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
          return {
            content: [{ type: "text", text: `Would update ${fields.join(", ") || "nothing"} on job ${id}. Call again with confirm:true.` }],
          };
        }
        let accepted: boolean | null = null;
        if (patch.agent) {
          const current = await dashboard.get<JobSummary>(`/api/jobs/${encodeURIComponent(id)}`);
          accepted = await askUser(
            buildJobConsentRequest({ name: patch.name ?? current.name, cron: patch.cron ?? current.cron, agent: patch.agent }),
          );
          if (accepted === false) {
            return { content: [{ type: "text", text: "The user declined — the job was not changed." }] };
          }
        }
        const job = await dashboard.request<JobSummary>(`/api/jobs/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { ...patch, source: "mcp", confirmed: accepted === true },
        });
        const lines = [`Updated job ${job.id}.`, formatJob({ ...job, nextRunAt: null, scheduleValid: true })];
        if (job.approval === "pending") lines.push("It is waiting for the user to Approve it in DevHub before it runs again.");
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }),
  );

  server.registerTool(
    "jobs_delete",
    {
      description: "Delete a DevHub scheduled job. Past run logs are kept. Requires confirm:true.",
      inputSchema: {
        id: z.string().min(1).describe("Job id from jobs_list"),
        confirm: z.boolean().optional().describe("Must be true to delete"),
      },
    },
    async ({ id, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return { content: [{ type: "text", text: `Would delete job ${id}. Call again with confirm:true.` }] };
        }
        await dashboard.request(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
        return { content: [{ type: "text", text: `Deleted job ${id}.` }] };
      }),
  );

  server.registerTool(
    "jobs_run",
    {
      description:
        "Trigger a DevHub scheduled job now, outside its schedule. Returns a run id: poll scripts_run_status for script jobs, agent_wait for agent jobs. Requires confirm:true.",
      inputSchema: {
        id: z.string().min(1).describe("Job id from jobs_list"),
        confirm: z.boolean().optional().describe("Must be true to run"),
      },
    },
    async ({ id, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) {
          return { content: [{ type: "text", text: `Would run job ${id} now. Call again with confirm:true.` }] };
        }
        const result = await dashboard.post<{ runId: string }>(`/api/jobs/${encodeURIComponent(id)}`, {});
        return { content: [{ type: "text", text: `Started run ${result.runId}.` }] };
      }),
  );
}
