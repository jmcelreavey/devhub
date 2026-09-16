import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const home = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/devhub-scheduler-test-${process.pid}`);
const runner = vi.hoisted(() => ({ busy: false, started: [] as string[] }));
const agents = vi.hoisted(() => ({ dispatched: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/notes/dir", () => ({ getHome: () => home }));
vi.mock("./scripts-runner", () => ({
  getAllowedScripts: () => ["validate", "update_and_sync"],
  getRun: () => undefined,
  getRunLogPayload: () => null,
  isAnyScriptRunning: () => runner.busy,
  startRun: (script: string) => {
    runner.started.push(script);
    return { runId: `run-${runner.started.length}` };
  },
}));
vi.mock("./agent-runs/dispatch", () => ({
  AgentDispatchError: class AgentDispatchError extends Error {},
  dispatchAgentRun: async (input: Record<string, unknown>) => {
    agents.dispatched.push(input);
    return { spec: { id: `agent-${agents.dispatched.length}` } };
  },
}));
vi.mock("./agent-runs/providers", () => ({
  getAgentProvider: (id: string) => (id === "claude" ? { spec: { id }, binPath: "/bin/claude" } : null),
}));
vi.mock("./agent-runs/store", () => ({ readAgentRun: () => null }));
vi.mock("./keep-awake", () => ({ holdAwake: () => {}, releaseFinishedHolds: () => {} }));
vi.mock("./wake-helper", () => ({
  scheduleWake: async (at: number) => ({ version: "1.0.0", scheduledAt: at }),
  cancelWake: async () => ({ version: "1.0.0", scheduledAt: null }),
  wakeHelperStatus: async () => {
    throw new Error("connect ENOENT");
  },
}));

type Scheduler = typeof import("./scheduler");

const jobsFile = path.join(home, ".local/state/devhub/jobs.json");
const agent = { provider: "claude", prompt: "Triage issues", cwd: "/tmp" };
const DAY = 24 * 60 * 60 * 1_000;

let s: Scheduler;

beforeEach(async () => {
  fs.rmSync(home, { recursive: true, force: true });
  runner.busy = false;
  runner.started.length = 0;
  agents.dispatched.length = 0;
  vi.resetModules();
  s = await import("./scheduler");
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function created(result: ReturnType<Scheduler["createJob"]>) {
  if ("error" in result) throw new Error(result.error);
  return result;
}

describe("jobs file", () => {
  it("keeps legacy script jobs, drops unknown scripts, and reads old jobs as not waking", () => {
    fs.mkdirSync(path.dirname(jobsFile), { recursive: true });
    fs.writeFileSync(
      jobsFile,
      JSON.stringify({
        version: 1,
        jobs: [
          { id: "a", name: "Validate", script: "validate", cron: "0 8 * * 1", enabled: true, createdAt: 1 },
          { id: "b", name: "Gone", script: "removed_script", cron: "0 8 * * 1", enabled: true, createdAt: 1 },
        ],
      }),
    );
    const jobs = s.listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["a"]);
    expect(jobs[0].kind).toBe("script");
    expect(jobs[0].wake).toBeUndefined();
  });

  it("rejects a job with both or neither action", () => {
    expect(s.createJob({ name: "x", cron: "* * * * *" }, { approved: true })).toEqual({
      error: "Provide exactly one of script or agent",
    });
    expect(s.createJob({ name: "x", cron: "* * * * *", script: "validate", agent }, { approved: true })).toHaveProperty("error");
    expect(s.createJob({ name: "x", cron: "* * * * *", agent: { ...agent, provider: "nope" } }, { approved: true })).toHaveProperty(
      "error",
    );
  });

  it("wakes for new jobs unless asked not to", () => {
    expect(created(s.createJob({ name: "a", cron: "0 7 * * *", script: "validate" }, { approved: true })).wake).toBe(true);
    expect(created(s.createJob({ name: "b", cron: "0 7 * * *", script: "validate", wake: false }, { approved: true })).wake).toBe(
      false,
    );
  });
});

describe("agent job approval", () => {
  it("never runs an unapproved agent job, then runs it once approved", async () => {
    const job = created(s.createJob({ name: "Triage", cron: "* * * * *", agent }, { approved: false }));
    expect(job.approval).toBe("pending");

    expect(await s.triggerNow(job.id)).toEqual({ error: "Job is waiting for approval in DevHub" });
    await s.runSchedulerTick(Date.now() + 5 * 60_000);
    expect(agents.dispatched).toHaveLength(0);

    expect(s.approveJob(job.id)).toMatchObject({ approval: "approved" });
    await s.runSchedulerTick(Date.now() + 2 * 60_000);
    expect(agents.dispatched).toHaveLength(1);
    expect(agents.dispatched[0]).toMatchObject({ provider: "claude", prompt: "Triage issues", depth: 0, scheduledJobId: job.id });
  });

  it("sends a rewritten agent job back for approval unless the rewrite was approved", () => {
    const job = created(s.createJob({ name: "Triage", cron: "0 7 * * *", agent }, { approved: true }));
    expect(job.approval).toBe("approved");

    expect(s.updateJob(job.id, { name: "Renamed" }, { approved: false })).toMatchObject({ approval: "approved" });
    expect(s.updateJob(job.id, { agent: { ...agent, prompt: "rm -rf everything" } }, { approved: false })).toMatchObject({
      approval: "pending",
    });
    // Unrelated edits never approve a pending job…
    expect(s.updateJob(job.id, { name: "Renamed again" }, { approved: true })).toMatchObject({ approval: "pending" });
    // …but a rewrite the user confirmed does, like a confirmed create.
    expect(s.updateJob(job.id, { agent: { ...agent, prompt: "Triage again" } }, { approved: true })).toMatchObject({
      approval: "approved",
    });
  });

  it("does not backfill occurrences that passed while a job waited for approval", async () => {
    const job = created(s.createJob({ name: "Triage", cron: "0 * * * *", agent }, { approved: false }));
    const patched = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
    patched.jobs[0].lastFiredFor = Date.now() - 3 * DAY;
    fs.writeFileSync(jobsFile, JSON.stringify(patched));
    vi.resetModules();
    s = await import("./scheduler");

    s.updateJob(job.id, { agent: { ...agent, prompt: "Triage again" } }, { approved: true });
    await s.runSchedulerTick(Date.now() + 1_000);
    expect(agents.dispatched).toHaveLength(0);
  });

  it("sends a script job turned into an agent job for approval", () => {
    const job = created(s.createJob({ name: "Validate", cron: "0 7 * * *", script: "validate" }, { approved: true }));
    const updated = s.updateJob(job.id, { agent }, { approved: false });
    expect(updated).toMatchObject({ approval: "pending", agent });
    expect(updated).not.toHaveProperty("script");
  });

  it("refuses approval of script jobs", () => {
    const job = created(s.createJob({ name: "Validate", cron: "0 7 * * *", script: "validate" }, { approved: false }));
    expect(job.approval).toBeUndefined();
    expect(s.approveJob(job.id)).toEqual({ error: "Only agent jobs need approval" });
  });
});

describe("separate module instances (instrumentation vs API routes)", () => {
  it("a route instance sees what the ticking instance recorded, and does not erase it", async () => {
    const route = s;
    const job = created(route.createJob({ name: "Validate", cron: "0 * * * *", script: "validate" }, { approved: true }));

    vi.resetModules();
    const ticker: Scheduler = await import("./scheduler");
    await ticker.runSchedulerTick(Date.now() + 2 * DAY);
    expect(runner.started).toEqual(["validate"]);

    const seen = route.getJob(job.id);
    expect(seen?.lastRunAt).toBeDefined();
    const firedFor = seen?.lastFiredFor;

    // An edit through the stale-looking instance must keep the tick's record…
    route.updateJob(job.id, { wake: false }, { approved: true });
    expect(route.getJob(job.id)?.lastFiredFor).toBe(firedFor);
    // …so the same occurrence never fires twice.
    await ticker.runSchedulerTick(Date.now() + 2 * DAY);
    expect(runner.started).toEqual(["validate"]);
  });
});

describe("catch-up", () => {
  it("runs a missed occurrence once, not once per miss", async () => {
    created(s.createJob({ name: "Validate", cron: "0 * * * *", script: "validate" }, { approved: true }));
    const later = Date.now() + 2 * DAY;
    await s.runSchedulerTick(later);
    await s.runSchedulerTick(later);
    expect(runner.started).toEqual(["validate"]);
  });

  it("leaves a script job due while another action runs", async () => {
    created(s.createJob({ name: "Validate", cron: "0 * * * *", script: "validate" }, { approved: true }));
    const later = Date.now() + DAY;
    runner.busy = true;
    await s.runSchedulerTick(later);
    expect(runner.started).toEqual([]);
    runner.busy = false;
    await s.runSchedulerTick(later);
    expect(runner.started).toEqual(["validate"]);
  });

  it("does not backfill time a job spent disabled", async () => {
    const job = created(s.createJob({ name: "Validate", cron: "0 * * * *", script: "validate", enabled: false }, { approved: true }));
    // Time passes while disabled…
    const patched = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
    patched.jobs[0].lastFiredFor = Date.now() - 3 * DAY;
    fs.writeFileSync(jobsFile, JSON.stringify(patched));
    vi.resetModules();
    s = await import("./scheduler");

    s.updateJob(job.id, { enabled: true }, { approved: true });
    await s.runSchedulerTick(Date.now() + 1_000);
    expect(runner.started).toEqual([]);
  });
});
