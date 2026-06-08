/**
 * In-app cron scheduler.
 *
 * Runs while the dashboard process is alive and triggers allow-listed scripts
 * on a cron schedule. Persists job definitions and last-run state to disk so
 * the user's schedule survives restarts.
 *
 * The scheduler keeps a single timer set to the soonest next-run; when that
 * fires it dispatches the script and re-schedules. Job CRUD invalidates the
 * timer and re-plans, so the timer is always consistent with the on-disk
 * state.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import { getHome } from "./notes-dir";
import {
  getAllowedScripts,
  startRun,
  isAnyScriptRunning,
  type AllowedScript,
} from "./scripts-runner";
import { writeAtomicNow } from "./atomic-write";

export interface Job {
  id: string;
  name: string;
  script: AllowedScript;
  cron: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastExitCode?: number;
}

export interface JobWithNext extends Job {
  nextRunAt: number | null;
  scheduleValid: boolean;
}

interface JobsFile {
  version: 1;
  jobs: Job[];
}

const STATE_DIR = path.join(/*turbopackIgnore: true*/ getHome(), ".local/state/devhub");
const JOBS_FILE = path.join(STATE_DIR, "jobs.json");

let jobsCache: Job[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function ensureDir(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readJobs(): Job[] {
  if (jobsCache) return jobsCache;
  ensureDir();
  if (!fs.existsSync(/*turbopackIgnore: true*/ JOBS_FILE)) {
    jobsCache = [];
    return jobsCache;
  }
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ JOBS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as JobsFile;
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const allowed = new Set(getAllowedScripts());
    const filtered = jobs.filter((j) => allowed.has(j.script));
    jobsCache = filtered;
    if (filtered.length !== jobs.length) {
      const data: JobsFile = { version: 1, jobs: filtered };
      writeAtomicNow(JOBS_FILE, JSON.stringify(data, null, 2) + "\n");
    }
  } catch {
    jobsCache = [];
  }
  return jobsCache;
}

function writeJobs(jobs: Job[]): void {
  ensureDir();
  const data: JobsFile = { version: 1, jobs };
  writeAtomicNow(JOBS_FILE, JSON.stringify(data, null, 2) + "\n");
  jobsCache = jobs;
}

function nextRunFor(job: Job, after: Date = new Date()): Date | null {
  if (!job.enabled) return null;
  try {
    const interval = CronExpressionParser.parse(job.cron, { currentDate: after });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export function listJobs(): JobWithNext[] {
  const jobs = readJobs();
  const now = new Date();
  return jobs.map((j) => {
    const next = nextRunFor(j, now);
    return {
      ...j,
      nextRunAt: next ? next.getTime() : null,
      scheduleValid: !!next || !j.enabled,
    };
  });
}

export function getJob(id: string): JobWithNext | undefined {
  return listJobs().find((j) => j.id === id);
}

export function validateCron(expr: string): { ok: boolean; error?: string } {
  try {
    CronExpressionParser.parse(expr);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid cron" };
  }
}

export function createJob(input: {
  name: string;
  script: AllowedScript;
  cron: string;
  enabled?: boolean;
}): Job | { error: string } {
  if (!getAllowedScripts().includes(input.script)) {
    return { error: "Unknown script" };
  }
  const v = validateCron(input.cron);
  if (!v.ok) return { error: v.error ?? "Invalid cron" };
  if (!input.name.trim()) return { error: "Name required" };

  const job: Job = {
    id: randomUUID(),
    name: input.name.trim(),
    script: input.script,
    cron: input.cron.trim(),
    enabled: input.enabled !== false,
    createdAt: Date.now(),
  };
  writeJobs([...readJobs(), job]);
  reschedule();
  return job;
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, "name" | "cron" | "enabled" | "script">>,
): Job | { error: string } {
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return { error: "Job not found" };
  const next = { ...jobs[idx], ...patch };
  if (patch.cron !== undefined) {
    const v = validateCron(patch.cron);
    if (!v.ok) return { error: v.error ?? "Invalid cron" };
  }
  if (patch.script !== undefined && !getAllowedScripts().includes(patch.script)) {
    return { error: "Unknown script" };
  }
  jobs[idx] = next;
  writeJobs(jobs);
  reschedule();
  return next;
}

export function deleteJob(id: string): boolean {
  const jobs = readJobs();
  const next = jobs.filter((j) => j.id !== id);
  if (next.length === jobs.length) return false;
  writeJobs(next);
  reschedule();
  return true;
}

export function triggerNow(id: string): { runId: string } | { error: string } {
  const job = readJobs().find((j) => j.id === id);
  if (!job) return { error: "Job not found" };
  return runJob(job);
}

function runJob(job: Job): { runId: string } | { error: string } {
  if (isAnyScriptRunning()) {
    return { error: "Another action is already running" };
  }
  const result = startRun(job.script);
  if ("error" in result) return result;

  // Mark last-run; exit-code/finishedAt are recorded on the audit log by the
  // runner itself, so we just store the start moment here.
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx !== -1) {
    jobs[idx] = { ...jobs[idx], lastRunAt: Date.now(), lastRunId: result.runId };
    writeJobs(jobs);
  }
  return result;
}

function pickNext(jobs: Job[], now: Date): { job: Job; at: Date } | null {
  let best: { job: Job; at: Date } | null = null;
  for (const job of jobs) {
    const next = nextRunFor(job, now);
    if (!next) continue;
    if (!best || next < best.at) best = { job, at: next };
  }
  return best;
}

function reschedule(): void {
  if (!running) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const jobs = readJobs().filter((j) => j.enabled);
  if (jobs.length === 0) return;

  const next = pickNext(jobs, new Date());
  if (!next) return;

  // setTimeout caps at ~24.8 days; clamp to that.
  const delay = Math.max(1_000, Math.min(next.at.getTime() - Date.now(), 2_000_000_000));
  timer = setTimeout(() => {
    timer = null;
    // Re-read in case the file changed during the wait.
    const fresh = readJobs().find((j) => j.id === next.job.id);
    const due = fresh ? nextRunFor(fresh) : null;
    // Only fire if still due within the next 30s (covers small clock drift).
    if (fresh && due && Math.abs(due.getTime() - next.at.getTime()) < 30_000) {
      runJob(fresh);
    }
    // Always reschedule for the following run.
    reschedule();
  }, delay);

  // Don't keep the event loop alive solely on this timer.
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as unknown as { unref: () => void }).unref();
  }
}

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  running = true;
  // Invalidate the cache once on boot so we re-read from disk.
  jobsCache = null;
  reschedule();
}
