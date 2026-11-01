import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSchedulerLog } from "../../../../apps/core/src/domains/scheduler/log.ts";
import {
  registerJobsTools,
  formatJob,
  type JobSummary,
} from "./jobs.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { DashboardClient, type DashboardToolResult } from "../dashboard-client.ts";

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

it("reads scheduler logs through the injected core service without HTTP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-scheduler-"));
  try {
    const file = path.join(root, "scheduler.log");
    const helperFile = path.join(root, "helper.log");
    fs.writeFileSync(file, "first 12345678\nother 87654321\nlast 12345678\n");
    fs.writeFileSync(helperFile, "wake\n");
    const handlers = new Map<string, (input: unknown) => Promise<DashboardToolResult>>();
    const dashboard = new DashboardClient("http://127.0.0.1:1");
    const get = vi.spyOn(dashboard, "get");
    const server = { registerTool: (name: string, _config: unknown, handler: (input: unknown) => Promise<DashboardToolResult>) => handlers.set(name, handler) };
    const schedulerLog = (input: { job?: string; lines?: number }) => readSchedulerLog(input, { file, helperFile, includeHelper: true });
    registerJobsTools(server as unknown as McpServer, { dashboard, schedulerLog } as Context);

    const result = await handlers.get("jobs_log")!({ job: " 12345678-extra ", lines: 1 });
    expect(result.content[0]).toMatchObject({ text: `Scheduler log (${file}):\nlast 12345678` });
    expect(get).not.toHaveBeenCalled();
    const unfiltered = await handlers.get("jobs_log")!({ lines: 1 });
    expect(unfiltered.content[0]).toMatchObject({ text: expect.stringContaining(`Wake helper log (${helperFile}):\nwake`) });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
