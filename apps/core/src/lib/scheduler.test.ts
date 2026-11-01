import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { execExternal } from "./exec-external";

vi.mock("../domains/scheduler/wake-helper", () => ({
  cancelWake: vi.fn(async () => ({ version: "test", scheduledAt: null })),
  scheduleWake: vi.fn(async () => ({ version: "test", scheduledAt: null })),
  wakeHelperStatus: vi.fn(async () => ({ version: "test", scheduledAt: null })),
}));

vi.mock("./keep-awake", () => ({
  holdAwake: vi.fn(),
  releaseFinishedHolds: vi.fn(),
}));

let home = "";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

it("defers a scheduler tick while another process owns the shared jobs", async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-scheduler-lock-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();

  const stateDir = path.join(home, ".local/state/devhub");
  const jobsFile = path.join(stateDir, "jobs.json");
  const lockFile = path.join(stateDir, "scheduler-tick.lock");
  const readyFile = path.join(home, "ready");
  const releaseFile = path.join(home, "release");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(jobsFile, JSON.stringify({ version: 1, jobs: [] }));

  const lockModule = fileURLToPath(new URL("./process-lock.ts", import.meta.url));
  const worker = `const fs = require("node:fs");
    const { tryAcquireProcessDirectoryLock } = require(${JSON.stringify(lockModule)});
    const release = tryAcquireProcessDirectoryLock(${JSON.stringify(lockFile)});
    if (!release) throw new Error("Could not acquire test lock");
    fs.writeFileSync(${JSON.stringify(readyFile)}, "ready");
    const timer = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(releaseFile)})) return;
      clearInterval(timer);
      release();
    }, 10);`;
  const child = execExternal(process.execPath, ["--import", "tsx", "--eval", worker], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    timeoutMs: 15_000,
  });

  try {
    const deadline = Date.now() + 8_000;
    while (!fs.existsSync(readyFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(fs.existsSync(readyFile)).toBe(true);

    const { runSchedulerTick } = await import("./scheduler");
    const { releaseFinishedHolds } = await import("./keep-awake");
    const readFile = vi.spyOn(fs, "readFileSync");
    await runSchedulerTick();
    expect(readFile.mock.calls.some(([file]) => file === jobsFile)).toBe(false);
    expect(releaseFinishedHolds).toHaveBeenCalledOnce();

    fs.writeFileSync(releaseFile, "release");
    await child;
    await runSchedulerTick();
    expect(readFile.mock.calls.some(([file]) => file === jobsFile)).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(false);
  } finally {
    fs.writeFileSync(releaseFile, "release");
    await child;
  }
}, 20_000);

it("records an occurrence before a subsequent tick can dispatch it again", async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-scheduler-occurrence-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();

  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const stateDir = path.join(home, ".local/state/devhub");
  const jobsFile = path.join(stateDir, "jobs.json");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(jobsFile, JSON.stringify({ version: 1, jobs: [{
    id: "fixture-job", name: "Fixture", cron: "* * * * *", enabled: true,
    createdAt: now - 120_000, agent: { provider: "synthetic", prompt: "test", cwd: home },
    approval: "approved", wake: false,
  }] }));

  const dispatchModule = await import("./agent-runs/dispatch");
  const dispatch = vi.spyOn(dispatchModule, "dispatchAgentRun").mockResolvedValue({
    spec: { id: "fixture-run" },
  } as Awaited<ReturnType<typeof dispatchModule.dispatchAgentRun>>);
  const { runSchedulerTick } = await import("./scheduler");
  await runSchedulerTick(now);
  await runSchedulerTick(now);

  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ requestId: `schedule:fixture-job:${now}` }));
  expect(JSON.parse(fs.readFileSync(jobsFile, "utf8")).jobs[0].lastFiredFor).toBe(now);
});

it("preserves unavailable plugin jobs when other schedules are read or edited", async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-scheduler-jobs-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();

  const stateDir = path.join(home, ".local/state/devhub");
  const jobsFile = path.join(stateDir, "jobs.json");
  const unavailableJob = {
    id: "unavailable-job",
    name: "Temporarily unavailable",
    cron: "* * * * *",
    enabled: true,
    createdAt: Date.now() - 120_000,
    script: "disabled-plugin-action",
    wake: false,
  };
  const existingJob = {
    id: "existing-job",
    name: "Existing job",
    cron: "0 8 * * *",
    enabled: false,
    createdAt: Date.now(),
    agent: { provider: "synthetic", prompt: "test", cwd: home },
    approval: "approved",
    wake: false,
  };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(jobsFile, JSON.stringify({ version: 1, jobs: [null, unavailableJob, existingJob] }));

  const { createJob, deleteJob, listJobs, runSchedulerTick, triggerNow, updateJob } = await import("./scheduler");
  const savedJobs = (): unknown[] => (JSON.parse(fs.readFileSync(jobsFile, "utf8")) as { jobs: unknown[] }).jobs;

  expect(listJobs().map((job) => job.id)).toEqual([existingJob.id]);
  expect(savedJobs()).toContainEqual(unavailableJob);
  expect(await triggerNow(unavailableJob.id)).toEqual({ error: "Job not found" });
  expect(updateJob(unavailableJob.id, { name: "Changed" }, { approved: true })).toEqual({ error: "Job not found" });
  expect(deleteJob(unavailableJob.id)).toBe(false);

  const created = createJob({
    name: "New job",
    cron: "0 9 * * *",
    enabled: false,
    wake: false,
    agent: { provider: "synthetic", prompt: "test", cwd: home },
  }, { approved: true });
  expect(created).not.toHaveProperty("error");
  expect(updateJob(existingJob.id, { name: "Updated job" }, { approved: true })).toMatchObject({ name: "Updated job" });
  expect(deleteJob(existingJob.id)).toBe(true);
  await runSchedulerTick();
  expect(savedJobs()).toContainEqual(unavailableJob);
  expect(savedJobs()).toContain(null);
});

it("does not change the shared wake when the scheduler is stopped", async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-scheduler-wake-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const globalStore = globalThis as typeof globalThis & { __devhubScheduler?: unknown };
  const previous = globalStore.__devhubScheduler;
  delete globalStore.__devhubScheduler;
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  try {
    const { getWakeState } = await import("./scheduler");
    const { wakeHelperStatus, cancelWake, scheduleWake } = await import("../domains/scheduler/wake-helper");
    vi.mocked(wakeHelperStatus).mockClear();
    vi.mocked(cancelWake).mockClear();
    vi.mocked(scheduleWake).mockClear();
    await getWakeState();
    expect(wakeHelperStatus).toHaveBeenCalledOnce();
    expect(cancelWake).not.toHaveBeenCalled();
    expect(scheduleWake).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, "platform", platform);
    globalStore.__devhubScheduler = previous;
  }
});
