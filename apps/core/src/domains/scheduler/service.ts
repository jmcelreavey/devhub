import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { schedulerStateDir } from "./paths";
import { appendSchedulerLog } from "./log";
import { dueOccurrence, earliestOccurrence, nextOccurrence } from "./plan";
import { emitCoreEvent } from "../events/core-events";
import type { AgentActivityContext, AgentRunStatus } from "../../../../../packages/shared/agent-runs/contracts.ts";
import type { AgentJobSpec, Job, JobInput, JobWithNext, WakeState } from "../../../../../packages/shared/scheduler/contracts.ts";
import type { WakeHelperReply } from "./wake-helper";

interface SchedulerDependencies {
  dispatchAgentRun(input: AgentJobSpec & { title: string; depth: number; scheduledJobId: string; requestId?: string; activity: AgentActivityContext }): Promise<{ spec: { id: string } }>;
  isActiveAgentRunState(state: AgentRunStatus["state"]): boolean;
  readAgentRun(id: string): { status: AgentRunStatus } | null;
  writeAtomicNow(file: string, data: string): void;
  holdAwake(key: string, isDone: () => boolean): void;
  releaseFinishedHolds(): void;
  tryAcquireProcessDirectoryLock(file: string): (() => void) | null;
  getAllowedScripts(): string[];
  getRun(id: string): { exitCode?: number } | undefined;
  getRunLogPayload(id: string): { exitCode?: number } | null;
  isAnyScriptRunning(): boolean;
  startRun(script: string): { runId: string } | { error: string };
  cancelWake(): Promise<WakeHelperReply>;
  scheduleWake(at: number): Promise<WakeHelperReply>;
  wakeHelperStatus(): Promise<WakeHelperReply>;
}

interface JobsFile {
  version: 1;
  jobs: Job[];
}

export function createScheduler({ dispatchAgentRun, isActiveAgentRunState, readAgentRun, writeAtomicNow, holdAwake, releaseFinishedHolds, tryAcquireProcessDirectoryLock, getAllowedScripts, getRun, getRunLogPayload, isAnyScriptRunning, startRun, cancelWake, scheduleWake, wakeHelperStatus }: SchedulerDependencies) {
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

  const STATE_DIR = schedulerStateDir();
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

  function setWakeState(next: WakeState): void {
    if (JSON.stringify(state.wakeState) === JSON.stringify(next)) return;
    state.wakeState = next;
    emitCoreEvent("jobs");
  }

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
      return Array.isArray(parsed.jobs) ? parsed.jobs : [];
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
    const idx = jobs.findIndex((j) => isJobAvailable(j) && j.id === id);
    if (idx === -1) return;
    jobs[idx] = { ...jobs[idx], ...patch };
    writeJobs(jobs);
  }

  function isJobAvailable(job: Job): boolean {
    if (!job || typeof job !== "object") return false;
    return job.script ? getAllowedScripts().includes(job.script) : Boolean(job.agent);
  }

  function isRunnable(job: Job): boolean {
    return isJobAvailable(job) && job.enabled && job.approval !== "pending";
  }

  function lastRunState(job: Job): string | undefined {
    if (!job.lastRunId) return undefined;
    if (job.agent) return readAgentRun(job.lastRunId)?.status.state;
    const run = getRunLogPayload(job.lastRunId);
    if (!run) return undefined;
    if (run.exitCode === undefined) return "running";
    return run.exitCode === 0 ? "succeeded" : "failed";
  }

  function listJobs(): JobWithNext[] {
    const now = Date.now();
    return readJobs().filter(isJobAvailable).map((j) => {
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

  function getJob(id: string): JobWithNext | undefined {
    return listJobs().find((j) => j.id === id);
  }

  function validateCron(expr: string): { ok: boolean; error?: string } {
    return nextOccurrence(expr, Date.now()) === null ? { ok: false, error: "Invalid cron expression" } : { ok: true };
  }

  function validateAction(input: { script?: string; agent?: AgentJobSpec }): string | null {
    if (Boolean(input.script) === Boolean(input.agent)) return "Provide exactly one of script or agent";
    if (input.script && !getAllowedScripts().includes(input.script)) return "Unknown script";
    if (input.agent) {
      // Catalog IDs belong to the connected workspace and may be custom profiles.
      // Validate readiness at dispatch so schedules can still be edited offline.
      if (!input.agent.provider.trim() || input.agent.provider.length > 200) return "Agent provider required";
      if (!input.agent.prompt.trim()) return "Agent prompt required";
      if (!input.agent.cwd.trim()) return "Agent cwd required";
    }
    return null;
  }

  /**
   * `approved` covers UI actions and MCP calls made with confirm:true.
   */
  function createJob(input: JobInput, opts: { approved: boolean }): Job | { error: string } {
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

  function updateJob(
    id: string,
    patch: Partial<Pick<Job, "name" | "cron" | "enabled" | "wake" | "script" | "agent">>,
    opts: { approved: boolean },
  ): Job | { error: string } {
    const jobs = readJobs();
    const idx = jobs.findIndex((j) => isJobAvailable(j) && j.id === id);
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
      // Confirmed MCP calls apply immediately, including previously pending jobs.
      const rewritten = defined.agent !== undefined || (current.script !== undefined && next.script === undefined);
      next.approval = opts.approved ? "approved" : rewritten ? "pending" : (current.approval ?? "pending");
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

  function approveJob(id: string): Job | { error: string } {
    const jobs = readJobs();
    const idx = jobs.findIndex((j) => isJobAvailable(j) && j.id === id);
    if (idx === -1) return { error: "Job not found" };
    if (!jobs[idx].agent) return { error: "Only agent jobs need approval" };
    // Approval does not backfill occurrences that passed while it waited.
    jobs[idx] = { ...jobs[idx], approval: "approved", lastFiredFor: Date.now() };
    writeJobs(jobs);
    log(`approved ${label(jobs[idx])}: ${describeAction(jobs[idx])}`);
    reschedule();
    return jobs[idx];
  }

  function deleteJob(id: string): boolean {
    const jobs = readJobs();
    const index = jobs.findIndex((j) => isJobAvailable(j) && j.id === id);
    if (index === -1) return false;
    const removed = jobs[index];
    writeJobs(jobs.filter((_, jobIndex) => jobIndex !== index));
    log(`deleted ${label(removed)}`);
    reschedule();
    return true;
  }

  async function triggerNow(id: string): Promise<{ runId: string } | { error: string }> {
    const job = readJobs().find((j) => isJobAvailable(j) && j.id === id);
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
      const run = await dispatchAgentRun({ ...job.agent, title: job.name, depth: 0, scheduledJobId: job.id,
        requestId: occurrence === undefined ? undefined : `schedule:${job.id}:${occurrence}`,
        activity: { source: "schedule", action: "scheduled-agent", jobId: job.id, occurrence },
      });
      patchJob(job.id, { ...handled, lastRunAt: Date.now(), lastRunId: run.spec.id, lastError: undefined });
      watchRun(job, "agent", run.spec.id);
      holdAwake(`agent:${run.spec.id}`, () => {
        const current = readAgentRun(run.spec.id);
        return !current || !isActiveAgentRunState(current.status.state);
      });
      return { runId: run.spec.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Mark the occurrence handled anyway: retrying a budget or config refusal
      // every 30 seconds would only spam the same error.
      warn(`${label(job)} dispatch refused: ${message}`);
      patchJob(job.id, { ...handled, lastError: message });
      return { error: message };
    }
  }

  /** One pass: run what is due, release finished holds, re-plan the wake. Exported for tests. */
  async function runSchedulerTick(now = Date.now()): Promise<void> {
    if (state.ticking) return;
    state.ticking = true;
    let release: (() => void) | null = null;
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
      release = tryAcquireProcessDirectoryLock(path.join(STATE_DIR, "scheduler-tick.lock"));
      if (release) {
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
      }
      reportFinishedRuns();
      releaseFinishedHolds();
      if (release) await syncWake(Date.now());
    } catch (err) {
      appendSchedulerLog("error", "scheduler", `tick failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    } finally {
      release?.();
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
      setWakeState({ helper: "ready", version: reply.version, scheduledAt: reply.scheduledAt, jobId: targetJob?.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const missing = /ENOENT|ECONNREFUSED/.test(message);
      if (missing && !state.missingHelperLogged) {
        state.missingHelperLogged = true;
        log("wake helper not installed — jobs run once the Mac is awake (Enable wake on Actions → Scheduled Jobs)");
      }
      if (!missing && previous.error !== message) warn(`wake helper error: ${message}`);
      state.lastWakeSent = null;
      setWakeState({
        helper: missing ? "unavailable" : "ready",
        scheduledAt: null,
        error: missing ? undefined : message,
      });
    }
  }

  /**
   * Current wake-helper state, asked of the helper on every read: it is a local
   * socket round trip, and anything cached goes stale the moment the user
   * installs, removes or upgrades the helper.
   */
  async function getWakeState(): Promise<WakeState> {
    if (process.platform !== "darwin") return state.wakeState;
    const previous = state.wakeState;
    try {
      const reply = await wakeHelperStatus();
      if (previous.helper !== "ready" || previous.version !== reply.version) {
        log(`wake helper ${reply.version} detected`);
        state.lastWakeSent = null;
        state.missingHelperLogged = false;
        if (state.tickTimer) void syncWake(Date.now());
      }
      setWakeState({ helper: "ready", version: reply.version, scheduledAt: reply.scheduledAt, jobId: previous.jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/ENOENT|ECONNREFUSED/.test(message)) {
        if (previous.helper === "ready") log("wake helper is no longer reachable — it was removed or stopped");
        setWakeState({ helper: "unavailable", scheduledAt: null });
        state.lastWakeSent = null;
      } else {
        setWakeState({ ...previous, error: message });
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

  function startScheduler(): void {
    if (state.tickTimer) return;
    state.tickTimer = setInterval(() => void runSchedulerTick(), TICK_MS);
    // Don't keep the event loop alive solely on this timer.
    state.tickTimer.unref();
    const jobs = readJobs();
    const runnable = jobs.filter(isRunnable);
    log(
      `started: ${jobs.length} job(s), ${runnable.length} runnable${process.platform === "darwin" ? `, ${runnable.filter((j) => j.wake === true).length} with scheduled wake` : ""}, ${jobs.filter((j) => isJobAvailable(j) && j.approval === "pending").length} waiting for approval`,
    );
    void runSchedulerTick();
  }

  return { listJobs, getJob, validateCron, createJob, updateJob, approveJob, deleteJob, triggerNow, runSchedulerTick, getWakeState, startScheduler };
}
