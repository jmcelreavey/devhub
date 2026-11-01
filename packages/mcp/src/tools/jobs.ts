import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  jobsCreate, jobsDelete, jobsGet, jobsList, jobsLog, jobsRun, jobsUpdate,
  type JobListValue, type JobSummary, type JobValue, type SchedulerLogResponse, type WakeSummary,
} from "../../../../packages/shared/actions/jobs.ts";
import { registerAction } from "../actions/register.ts";
import { dashboardActionRequest } from "../actions/request.ts";
import type { Context } from "../context.ts";

export { PREFER_JOBS } from "../../../../packages/shared/actions/jobs.ts";
export type { JobSummary, SchedulerLogResponse, WakeSummary } from "../../../../packages/shared/actions/jobs.ts";

export function formatSchedulerLog(data: SchedulerLogResponse): string {
  const parts = [`Scheduler log (${data.file}):`, data.lines.length ? data.lines.join("\n") : "(no entries yet)"];
  if (data.helper) {
    parts.push("", `Wake helper log (${data.helper.file}):`, data.helper.lines.length ? data.helper.lines.join("\n") : "(empty or unreadable — is the wake helper installed?)");
  }
  return parts.join("\n");
}

function when(timestamp: number | null | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "—";
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

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

export function registerJobsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;
  registerAction(server, jobsList, {
    list: () => dashboardActionRequest(() => dashboard.get<JobListValue>("/api/jobs")),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    const data = result.value;
    const jobs = data.jobs ?? [];
    return textResult([
      formatWake(data.wake), "", jobs.length ? jobs.map((job) => formatJob(job)).join("\n") : "No scheduled jobs.", "",
      `Scripts: ${(data.scripts ?? []).join(", ")}`,
      `Agent providers: ${(data.providers ?? []).filter((provider) => provider.installed).map((provider) => provider.id).join(", ") || "none installed"}`,
    ].join("\n"));
  });

  registerAction(server, jobsGet, {
    get: (id) => dashboardActionRequest(() => dashboard.get<JobSummary>(`/api/jobs/${encodeURIComponent(id)}`)),
  }, (result) => result.ok ? textResult(formatJob(result.value, true)) : textResult(result.error, true));

  registerAction(server, jobsLog, {
    read: (input) => dashboardActionRequest(async () => ctx.schedulerLog(input)),
  }, (result) => result.ok ? textResult(formatSchedulerLog(result.value)) : textResult(result.error, true));

  registerAction(server, jobsCreate, {
    requireConfirmation: true,
    create: (input) => dashboardActionRequest(() => dashboard.post<JobValue>("/api/jobs", { ...input, source: "mcp", confirmed: true })),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    return textResult(result.value.kind === "preview" ? result.value.message : `Created job ${result.value.job.id}.`);
  });

  registerAction(server, jobsUpdate, {
    requireConfirmation: true,
    update: (id, patch) => dashboardActionRequest(() => dashboard.request<JobSummary>(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH", body: { ...patch, source: "mcp", confirmed: true },
    })),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    if (result.value.kind === "preview") return textResult(result.value.message);
    const job = result.value.job;
    return textResult(`Updated job ${job.id}.\n${formatJob({ ...job, kind: job.kind ?? "script", nextRunAt: null, scheduleValid: true })}`);
  });

  registerAction(server, jobsDelete, {
    requireConfirmation: true,
    remove: (id) => dashboardActionRequest(async () => {
      await dashboard.request(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { ok: true as const };
    }),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    return textResult(result.value.kind === "preview" ? result.value.message : `Deleted job ${result.value.id}.`);
  });

  registerAction(server, jobsRun, {
    requireConfirmation: true,
    run: (id) => dashboardActionRequest(async () => {
      const path = `/api/jobs/${encodeURIComponent(id)}`;
      const job = await dashboard.get<JobSummary>(path);
      if (job.approval === "pending") {
        await dashboard.request(path, { method: "PATCH", body: { approve: true, source: "mcp", confirmed: true } });
      }
      return dashboard.post<{ runId: string }>(path, {});
    }),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    return textResult(result.value.kind === "preview" ? result.value.message : `Started run ${result.value.runId}.`);
  });
}
