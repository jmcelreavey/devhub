/**
 * In-app cron scheduler.
 *
 * Runs while the dashboard process is alive and triggers allow-listed scripts
 * or agent dispatches on a cron schedule. Job definitions and last-run state
 * persist to disk so the schedule survives restarts.
 *
 * A short wall-clock tick decides what is due (see scheduler-plan.ts for why
 * not one long timer). Missed occurrences — the Mac was asleep or DevHub was
 * closed — run once on the next tick. On macOS the scheduler also asks the
 * root wake helper to wake the Mac for the next job that wants it, and holds
 * an idle-sleep assertion around runs so a woken Mac stays up to do the work.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getHome } from "@/lib/notes/dir";
import {
  getAllowedScripts,
  getRun,
  getRunLogPayload,
  startRun,
  isAnyScriptRunning,
  type AllowedScript,
} from "./scripts-runner";
import { writeAtomicNow } from "./atomic-write";
import { dueOccurrence, earliestOccurrence, nextOccurrence } from "./scheduler-plan";
import { AgentDispatchError, dispatchAgentRun } from "./agent-runs/dispatch";
import { getAgentProvider } from "./agent-runs/providers";
import { readAgentRun } from "./agent-runs/store";
import { isActiveAgentRunState } from "./agent-runs/run-files";
import { holdAwake, releaseFinishedHolds } from "./keep-awake";
import { cancelWake, scheduleWake, wakeHelperStatus } from "./wake-helper";
import { appendSchedulerLog } from "./scheduler-log";

export interface AgentJobSpec {
  provider: string;
  prompt: string;
  cwd: string;
  model?: string;
  worktree?: boolean;
  maxTurns?: number;
}

export interface Job {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  /** Allow-listed action. Exactly one of `script` / `agent` is set. */
  script?: AllowedScript;
  /** Agent dispatch, run with approvals off like `agent_dispatch`. */
  agent?: AgentJobSpec;
  /** Wake the Mac for this job. Jobs saved before wake support read as false. */
  wake?: boolean;
  /**
   * Agent jobs not created by a human in the UI wait here until one approves
   * them — a prompt-injected agent must not be able to plant a recurring,
   * approvals-off run.
   */
  approval?: "pending" | "approved";
  /** Latest cron occurrence already handled. */
  lastFiredFor?: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastExitCode?: number;
  lastError?: string;
}

export interface JobWithNext extends Job {
  kind: "script" | "agent";
  nextRunAt: number | null;
  scheduleValid: boolean;
  /** Script: "running" | "succeeded" | "failed". Agent: its run state. */
  lastRunState?: string;
}

export interface WakeState {
  helper: "ready" | "unavailable" | "unsupported";
  version?: string;
  /** Epoch ms the helper will wake the Mac, as it last reported. */
  scheduledAt: number | null;
  /** The job the wake is for. */
  jobId?: string;
  error?: string;
}

interface JobsFile {
  version: 1;
  jobs: Job[];
}

export type JobInput = Pick<Job, "name" | "cron"> &
  Partial<Pick<Job, "enabled" | "wake" | "script" | "agent">>;

interface SchedulerState {
  tickTimer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  wakeState: WakeState;
  lastWakeSent: { at: number | null; sentAt: number } | null;
  /** Runs this scheduler started, watched so how they ended gets logged. */
  inflight: Map<string, { job: string; kind: "script" | "agent"; startedAt: number }>;
  /** `jobId:occurrence` already logged as waiting on a busy runner. */
  busyLogged: Set<string>;
  missingHelperLogged: boolean;
}

const STATE_DIR = path.join(/*turbopackIgnore: true*/ getHome(), ".local/state/devhub");
const JOBS_FILE = path.join(STATE_DIR, "jobs.json");

const TICK_MS = 30_000;
/** Wake this long before the job so the network is up when the tick fires it. */
const WAKE_LEAD_MS = 60_000;
/** Hold the Mac awake from this long before a waking job until it has started. */
const PRE_RUN_HOLD_MS = 3 * 60_000;
/** Re-send an unchanged wake now and then, in case the helper restarted. */
const WAKE_RESEND_MS = 10 * 60_000;

/**
 * Pinned to globalThis. Next loads instrumentation (which runs the tick) and
 * the /api/jobs routes as separate module instances in one process; module
 * state would split into a ticking copy and a stale copy the UI reads. For
 * the same reason jobs are never cached in memory — jobs.json is tiny, and a
 * stale copy written back by a route would erase what the tick recorded.
 */
const globalStore = globalThis as typeof globalThis & { __devhubScheduler?: SchedulerState };
const state: SchedulerState = (globalStore.__devhubScheduler ??= {
  tickTimer: null,
  ticking: false,
  wakeState: { helper: process.platform === "darwin" ? "unavailable" : "unsupported", scheduledAt: null },
  lastWakeSent: null,
  inflight: new Map(),
  busyLogged: new Set(),
  missingHelperLogged: false,
});
// A dev-server hot reload can hand back a state object from before these fields existed.
state.inflight ??= new Map();
state.busyLogged ??= new Set();

/** scheduler.log (GET /api/jobs/log, jobs_log) and the console, which the desktop log captures. */
function log(message: string): void {
  appendSchedulerLog("info", "scheduler", message);
}

function warn(message: string): void {
  appendSchedulerLog("warn", "scheduler", message);
}

function label(job: Pick<Job, "id" | "name">): string {
  return `"${job.name}" (${job.id.slice(0, 8)})`;
}

function describeAction(job: Job): string {
  return job.agent ? `agent ${job.agent.provider} in ${job.agent.cwd}` : `script ${job.script}`;
}

function when(ms: number): string {
  return new Date(ms).toLocaleString();
}

function readJobs(): Job[] {
  if (!fs.existsSync(/*turbopackIgnore: true*/ JOBS_FILE)) return [];
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ JOBS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as JobsFile;
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const allowed = new Set(getAllowedScripts());
    const filtered = jobs.filter((j) => (j.agent ? true : Boolean(j.script && allowed.has(j.script))));
    if (filtered.length !== jobs.length) writeJobs(filtered);
    return filtered;
  } catch {
    return [];
  }
}

function writeJobs(jobs: Job[]): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const data: JobsFile = { version: 1, jobs };
  writeAtomicNow(JOBS_FILE, JSON.stringify(data, null, 2) + "\n");
}

/** Re-read and patch one job, so a run finishing never clobbers a concurrent edit. */
function patchJob(id: string, patch: Partial<Job>): void {
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return;
  jobs[idx] = { ...jobs[idx], ...patch };
  writeJobs(jobs);
}

function isRunnable(job: Job): boolean {
  return job.enabled && job.approval !== "pending";
}

function lastRunState(job: Job): string | undefined {
  if (!job.lastRunId) return undefined;
  if (job.agent) return readAgentRun(job.lastRunId)?.status.state;
  const run = getRunLogPayload(job.lastRunId);
  if (!run) return undefined;
  if (run.exitCode === undefined) return "running";
  return run.exitCode === 0 ? "succeeded" : "failed";
}

export function listJobs(): JobWithNext[] {
  const now = Date.now();
  return readJobs().map((j) => {
    const next = j.enabled ? nextOccurrence(j.cron, now) : null;
    return {
      ...j,
      kind: j.agent ? "agent" : "script",
      nextRunAt: next,
      scheduleValid: next !== null || !j.enabled,
      lastRunState: lastRunState(j),
    };
  });
}

export function getJob(id: string): JobWithNext | undefined {
  return listJobs().find((j) => j.id === id);
}

export function validateCron(expr: string): { ok: boolean; error?: string } {
  return nextOccurrence(expr, Date.now()) === null ? { ok: false, error: "Invalid cron expression" } : { ok: true };
}

function validateAction(input: { script?: string; agent?: AgentJobSpec }): string | null {
  if (Boolean(input.script) === Boolean(input.agent)) return "Provide exactly one of script or agent";
  if (input.script && !getAllowedScripts().includes(input.script as AllowedScript)) return "Unknown script";
  if (input.agent) {
    const provider = getAgentProvider(input.agent.provider);
    if (!provider) return `Unknown agent provider "${input.agent.provider}"`;
    if (!input.agent.prompt.trim()) return "Agent prompt required";
    if (!input.agent.cwd.trim()) return "Agent cwd required";
  }
  return null;
}

/**
 * `approved` is true only for a human acting in the DevHub UI, or an MCP
 * client whose user just confirmed in-band. It decides whether a new or
 * rewritten agent job may run before someone clicks Approve.
 */
export function createJob(input: JobInput, opts: { approved: boolean }): Job | { error: string } {
  const actionError = validateAction(input);
  if (actionError) return { error: actionError };
  const v = validateCron(input.cron);
  if (!v.ok) return { error: v.error ?? "Invalid cron" };
  if (!input.name.trim()) return { error: "Name required" };

  const now = Date.now();
  const job: Job = {
    id: randomUUID(),
    name: input.name.trim(),
    cron: input.cron.trim(),
    enabled: input.enabled !== false,
    createdAt: now,
    wake: input.wake !== false,
    lastFiredFor: now,
    ...(input.script ? { script: input.script } : {}),
    ...(input.agent ? { agent: input.agent, approval: opts.approved ? "approved" : "pending" } : {}),
  };
  writeJobs([...readJobs(), job]);
  log(
    `created ${label(job)}: ${job.cron} → ${describeAction(job)}${job.wake ? ", wakes the Mac" : ""}${job.enabled ? "" : ", disabled"}${job.approval === "pending" ? " — waiting for approval" : ""}`,
  );
  reschedule();
  return job;
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, "name" | "cron" | "enabled" | "wake" | "script" | "agent">>,
  opts: { approved: boolean },
): Job | { error: string } {
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return { error: "Job not found" };
  const current = jobs[idx];
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as typeof patch;
  const next: Job = { ...current, ...defined };

  if (defined.script !== undefined || defined.agent !== undefined) {
    // Switching kind drops the other half; exactly one must remain.
    if (defined.script !== undefined) delete next.agent;
    if (defined.agent !== undefined) delete next.script;
    const actionError = validateAction(next);
    if (actionError) return { error: actionError };
  }
  if (defined.cron !== undefined) {
    const v = validateCron(defined.cron);
    if (!v.ok) return { error: v.error ?? "Invalid cron" };
  }

  if (next.agent) {
    // Only a change to what the agent does needs a fresh human decision.
    const rewritten = defined.agent !== undefined || (current.script !== undefined && next.script === undefined);
    next.approval = rewritten ? (opts.approved ? "approved" : "pending") : (current.approval ?? "pending");
  } else {
    delete next.approval;
  }

  // A new schedule, re-enabling, or approval starts from now: no catch-up for
  // time the job did not have this schedule, was off, or was waiting.
  const resumed = defined.enabled === true && !current.enabled;
  const approvedNow = next.approval === "approved" && current.approval !== "approved";
  if ((defined.cron !== undefined && defined.cron !== current.cron) || resumed || approvedNow) {
    next.lastFiredFor = Date.now();
  }

  jobs[idx] = next;
  writeJobs(jobs);
  const sentBack = next.approval === "pending" && current.approval !== "pending";
  log(
    `updated ${label(next)}: ${Object.keys(defined).join(", ") || "no changes"}${sentBack ? " — sent back for approval" : ""}${approvedNow ? " — approved" : ""}`,
  );
  reschedule();
  return next;
}

export function approveJob(id: string): Job | { error: string } {
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return { error: "Job not found" };
  if (!jobs[idx].agent) return { error: "Only agent jobs need approval" };
  // Approval does not backfill occurrences that passed while it waited.
  jobs[idx] = { ...jobs[idx], approval: "approved", lastFiredFor: Date.now() };
  writeJobs(jobs);
  log(`approved ${label(jobs[idx])}: ${describeAction(jobs[idx])}`);
  reschedule();
  return jobs[idx];
}

export function deleteJob(id: string): boolean {
  const jobs = readJobs();
  const removed = jobs.find((j) => j.id === id);
  if (!removed) return false;
  writeJobs(jobs.filter((j) => j.id !== id));
  log(`deleted ${label(removed)}`);
  reschedule();
  return true;
}

export async function triggerNow(id: string): Promise<{ runId: string } | { error: string }> {
  const job = readJobs().find((j) => j.id === id);
  if (!job) return { error: "Job not found" };
  if (job.approval === "pending") return { error: "Job is waiting for approval in DevHub" };
  return runJob(job);
}

function logStart(job: Job, occurrence: number | undefined): void {
  if (occurrence === undefined) {
    log(`running ${label(job)} now (triggered manually): ${describeAction(job)}`);
    return;
  }
  const late = Date.now() - occurrence;
  const catchUp = late > TICK_MS * 2 ? `, catching up ${Math.round(late / 60_000)} min late` : "";
  log(`running ${label(job)} for ${when(occurrence)}${catchUp}: ${describeAction(job)}`);
}

function watchRun(job: Job, kind: "script" | "agent", runId: string): void {
  state.inflight.set(runId, { job: label(job), kind, startedAt: Date.now() });
  log(`${label(job)} started ${kind} run ${runId}`);
}

/** Log how scheduler-started runs ended; the run itself keeps the full output. */
function reportFinishedRuns(): void {
  for (const [runId, run] of state.inflight) {
    let outcome: string | null = null;
    let ok = false;
    if (run.kind === "script") {
      const payload = getRunLogPayload(runId);
      if (!payload) outcome = "no run log found";
      else if (payload.exitCode !== undefined) {
        outcome = `exit ${payload.exitCode}`;
        ok = payload.exitCode === 0;
      }
    } else {
      const agentRun = readAgentRun(runId);
      if (!agentRun) outcome = "run record missing";
      else if (!isActiveAgentRunState(agentRun.status.state)) {
        outcome = agentRun.status.error ? `${agentRun.status.state}: ${agentRun.status.error}` : agentRun.status.state;
        ok = agentRun.status.state === "succeeded";
      }
    }
    if (outcome === null) continue;
    state.inflight.delete(runId);
    const line = `${run.job} ${run.kind} run ${runId} finished after ${Math.round((Date.now() - run.startedAt) / 1_000)}s: ${outcome}`;
    if (ok) log(line);
    else warn(line);
  }
}

async function runJob(job: Job, occurrence?: number): Promise<{ runId: string } | { error: string }> {
  const handled = occurrence !== undefined ? { lastFiredFor: occurrence } : {};

  if (job.script) {
    if (isAnyScriptRunning()) return { error: "Another action is already running" };
    logStart(job, occurrence);
    const result = startRun(job.script);
    if ("error" in result) {
      warn(`${label(job)} could not start: ${result.error}`);
      patchJob(job.id, { ...handled, lastError: result.error });
      return result;
    }
    patchJob(job.id, { ...handled, lastRunAt: Date.now(), lastRunId: result.runId, lastError: undefined });
    watchRun(job, "script", result.runId);
    holdAwake(`script:${result.runId}`, () => {
      const run = getRun(result.runId);
      return !run || run.exitCode !== undefined;
    });
    return result;
  }

  if (!job.agent) return { error: "Job has no action" };
  logStart(job, occurrence);
  try {
    const run = await dispatchAgentRun({ ...job.agent, title: job.name, depth: 0, scheduledJobId: job.id });
    patchJob(job.id, { ...handled, lastRunAt: Date.now(), lastRunId: run.spec.id, lastError: undefined });
    watchRun(job, "agent", run.spec.id);
    holdAwake(`agent:${run.spec.id}`, () => {
      const current = readAgentRun(run.spec.id);
      return !current || !isActiveAgentRunState(current.status.state);
    });
    return { runId: run.spec.id };
  } catch (err) {
    const message = err instanceof AgentDispatchError || err instanceof Error ? err.message : String(err);
    // Mark the occurrence handled anyway: retrying a budget or config refusal
    // every 30 seconds would only spam the same error.
    warn(`${label(job)} dispatch refused: ${message}`);
    patchJob(job.id, { ...handled, lastError: message });
    return { error: message };
  }
}

/** One pass: run what is due, release finished holds, re-plan the wake. Exported for tests. */
export async function runSchedulerTick(now = Date.now()): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    // Always from disk: a second dashboard (dev server beside the desktop app)
    // shares jobs.json, and its lastFiredFor writes are what stop both firing.
    for (const job of readJobs()) {
      if (!isRunnable(job)) continue;
      const due = dueOccurrence(job.cron, job.lastFiredFor ?? job.lastRunAt ?? job.createdAt, now);
      if (due === null) continue;
      // Leave it due: the next tick retries once the other action finishes.
      const busyKey = `${job.id}:${due}`;
      if (job.script && isAnyScriptRunning()) {
        if (!state.busyLogged.has(busyKey)) {
          state.busyLogged.add(busyKey);
          log(`${label(job)} is due but another action is running — retrying every ${TICK_MS / 1_000}s`);
        }
        continue;
      }
      state.busyLogged.delete(busyKey);
      await runJob(job, due);
    }
    reportFinishedRuns();
    releaseFinishedHolds();
    await syncWake(Date.now());
  } catch (err) {
    appendSchedulerLog("error", "scheduler", `tick failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  } finally {
    state.ticking = false;
  }
}

/** Tell the wake helper about the next job that wants the Mac awake. */
async function syncWake(now: number): Promise<void> {
  if (process.platform !== "darwin") return;
  const waking = readJobs().filter((j) => isRunnable(j) && j.wake === true);
  const target = earliestOccurrence(
    waking.map((j) => j.cron),
    now,
  );
  const targetJob = target === null ? undefined : waking.find((j) => nextOccurrence(j.cron, now) === target);

  if (target !== null && target - now <= PRE_RUN_HOLD_MS) {
    holdAwake(`pre-run:${target}`, () => Date.now() > target + TICK_MS * 2);
  }

  // Too close to schedule: the Mac is awake now and the pre-run hold keeps it so.
  const at = target === null ? null : target - WAKE_LEAD_MS;
  if (at !== null && at < now + 15_000) return;

  const sent = state.lastWakeSent;
  const ready = state.wakeState.helper === "ready";
  if (ready && sent?.at === at && now - sent.sentAt < WAKE_RESEND_MS) return;
  if (ready && at === null && sent?.at === null) return;

  const previous = state.wakeState;
  try {
    const reply = at === null ? await cancelWake() : await scheduleWake(at);
    // Log changes, not the periodic re-send of the same wake.
    if (sent?.at !== at || previous.helper !== "ready") {
      log(
        at === null
          ? "no enabled job wakes the Mac — cleared DevHub's scheduled wake"
          : `Mac will wake at ${when(at)} for ${targetJob ? label(targetJob) : "the next job"}`,
      );
    }
    state.lastWakeSent = { at, sentAt: now };
    state.missingHelperLogged = false;
    state.wakeState = { helper: "ready", version: reply.version, scheduledAt: reply.scheduledAt, jobId: targetJob?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = /ENOENT|ECONNREFUSED/.test(message);
    if (missing && !state.missingHelperLogged) {
      state.missingHelperLogged = true;
      log("wake helper not installed — jobs run once the Mac is awake (Enable wake on Actions → Scheduled Jobs)");
    }
    if (!missing && previous.error !== message) warn(`wake helper error: ${message}`);
    state.lastWakeSent = null;
    state.wakeState = {
      helper: missing ? "unavailable" : "ready",
      scheduledAt: null,
      error: missing ? undefined : message,
    };
  }
}

/**
 * Current wake-helper state, asked of the helper on every read: it is a local
 * socket round trip, and anything cached goes stale the moment the user
 * installs, removes or upgrades the helper.
 */
export async function getWakeState(): Promise<WakeState> {
  if (process.platform !== "darwin") return state.wakeState;
  const previous = state.wakeState;
  try {
    const reply = await wakeHelperStatus();
    if (previous.helper !== "ready" || previous.version !== reply.version) {
      log(`wake helper ${reply.version} detected`);
      state.lastWakeSent = null;
      state.missingHelperLogged = false;
      void syncWake(Date.now());
    }
    state.wakeState = { helper: "ready", version: reply.version, scheduledAt: reply.scheduledAt, jobId: previous.jobId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT|ECONNREFUSED/.test(message)) {
      if (previous.helper === "ready") log("wake helper is no longer reachable — it was removed or stopped");
      state.wakeState = { helper: "unavailable", scheduledAt: null };
      state.lastWakeSent = null;
    } else {
      state.wakeState = { ...previous, error: message };
    }
  }
  return state.wakeState;
}

function reschedule(): void {
  if (!state.tickTimer) return;
  // CRUD never fires a job; it only re-plans the wake.
  void syncWake(Date.now()).catch((err) =>
    appendSchedulerLog("error", "scheduler", `wake sync failed: ${err instanceof Error ? err.message : String(err)}`),
  );
}

export function startScheduler(): void {
  if (state.tickTimer) return;
  state.tickTimer = setInterval(() => void runSchedulerTick(), TICK_MS);
  // Don't keep the event loop alive solely on this timer.
  state.tickTimer.unref();
  const jobs = readJobs();
  const runnable = jobs.filter(isRunnable);
  log(
    `started: ${jobs.length} job(s), ${runnable.length} runnable, ${runnable.filter((j) => j.wake === true).length} waking the Mac, ${jobs.filter((j) => j.approval === "pending").length} waiting for approval`,
  );
  void runSchedulerTick();
}
