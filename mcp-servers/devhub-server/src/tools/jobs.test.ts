import { describe, expect, it, vi } from "vitest";
import {
  registerJobsTools,
  formatJob,
  formatSchedulerLog,
  formatWake,
  PREFER_JOBS,
  type JobSummary,
} from "./jobs.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { DashboardClient, type DashboardToolResult } from "../dashboard-client.ts";
import { SERVER_INSTRUCTIONS } from "../server.ts";

const base: JobSummary = {
  id: "j1",
  name: "Morning triage",
  cron: "0 7 * * 1-5",
  enabled: true,
  kind: "agent",
  agent: { provider: "claude", cwd: "~/Developer/app", prompt: "Triage new issues\nand label them" },
  wake: true,
  approval: "pending",
  nextRunAt: null,
  scheduleValid: true,
};

describe("formatJob", () => {
  it("flags jobs waiting for approval so the model tells the user", () => {
    const text = formatJob(base);
    expect(text).toContain("WAITING FOR APPROVAL");
    expect(text).toContain("agent claude in ~/Developer/app");
    expect(text).toContain("wakes Mac");
    expect(text).not.toContain("Triage new issues");
  });

  it("includes the prompt only in full mode", () => {
    expect(formatJob(base, true)).toContain("    Triage new issues\n    and label them");
  });

  it("shows script jobs and last errors", () => {
    const text = formatJob({ ...base, kind: "script", agent: undefined, script: "validate", approval: undefined, lastError: "boom" });
    expect(text).toContain("script validate");
    expect(text).toContain("last error: boom");
  });
});

describe("formatWake", () => {
  it("tells the model when the helper is missing", () => {
    expect(formatWake({ helper: "unavailable", scheduledAt: null })).toContain("NOT installed");
    expect(formatWake({ helper: "ready", version: "1.0.0", scheduledAt: null })).toContain("no wake scheduled");
    expect(formatWake(undefined)).toContain("not supported");
  });
});

describe("formatSchedulerLog", () => {
  it("shows scheduler lines and the helper log, with clear empty states", () => {
    const text = formatSchedulerLog({
      file: "/home/.local/state/devhub/scheduler.log",
      lines: ["2026-09-14T18:19:09Z INFO  [scheduler] running \"Wake test\" (8664b37a)"],
      helper: { file: "/var/log/com.devhub.wake-helper.log", lines: [] },
    });
    expect(text).toContain("Scheduler log (/home/.local/state/devhub/scheduler.log):");
    expect(text).toContain('running "Wake test"');
    expect(text).toContain("is the wake helper installed?");
    expect(formatSchedulerLog({ file: "f", lines: [], helper: null })).toBe("Scheduler log (f):\n(no entries yet)");
  });
});

describe("scheduling preference", () => {
  it("steers harnesses away from their own cron tools", () => {
    expect(PREFER_JOBS).toMatch(/CronCreate/);
    expect(SERVER_INSTRUCTIONS).toMatch(/jobs_create/);
  });
  it("tells harnesses to prefer DevHub for tasks, notes, Jira, PRs and repos, and to fall back when it is down", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/Prefer DevHub[\s\S]*tasks_\*[\s\S]*jira_\*[\s\S]*prs_\*[\s\S]*repos_\*/);
    expect(SERVER_INSTRUCTIONS).toMatch(/unreachable[\s\S]*normal tools/);
  });
});

describe("immediate MCP job writes", () => {
  function setup() {
    const handlers = new Map<string, (input: unknown) => Promise<DashboardToolResult>>();
    const dashboard = new DashboardClient("http://localhost:1350");
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ ...base, approval: "approved", runId: "run-1" });
    const request = vi.spyOn(dashboard, "request").mockResolvedValue({ ...base, approval: "approved" });
    const get = vi.spyOn(dashboard, "get").mockResolvedValue(base);
    const elicitInput = vi.fn().mockRejectedValue(new Error("Must not ask for approval"));
    const server = { registerTool: (name: string, _config: unknown, handler: (input: unknown) => Promise<DashboardToolResult>) => handlers.set(name, handler), server: { elicitInput, getClientCapabilities: () => ({ elicitation: { form: {} } }) } };
    registerJobsTools(server as unknown as McpServer, { dashboard } as Context);
    return { call: (name: string, input: unknown) => handlers.get(name)!(input), post, request, get, elicitInput };
  }

  it("creates and updates agent jobs without elicitation", async () => {
    const { call, post, request, elicitInput } = setup();
    await call("jobs_create", { name: base.name, cron: base.cron, agent: base.agent, confirm: true });
    expect(post).toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ source: "mcp", confirmed: true, agent: base.agent }));
    await call("jobs_update", { id: base.id, name: "Renamed", confirm: true });
    expect(request).toHaveBeenCalledWith("/api/jobs/j1", { method: "PATCH", body: { name: "Renamed", source: "mcp", confirmed: true } });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it("runs a previously pending job immediately", async () => {
    const { call, post, request, elicitInput } = setup();
    await call("jobs_run", { id: base.id, confirm: true });
    expect(request).toHaveBeenCalledWith("/api/jobs/j1", { method: "PATCH", body: { approve: true, source: "mcp", confirmed: true } });
    expect(post).toHaveBeenCalledWith("/api/jobs/j1", {});
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it("keeps confirm false as a preview without writes", async () => {
    const { call, post, request } = setup();
    await call("jobs_create", { name: base.name, cron: base.cron, agent: base.agent, confirm: false });
    await call("jobs_update", { id: base.id, name: "Renamed", confirm: false });
    await call("jobs_run", { id: base.id, confirm: false });
    expect(post).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
