import { createScheduler } from "../domains/scheduler/service";
import { dispatchAgentRun } from "./agent-runs/dispatch";
import { isActiveAgentRunState } from "./agent-runs/run-files";
import { readAgentRun } from "./agent-runs/store";
import { writeAtomicNow } from "./atomic-write";
import { holdAwake, releaseFinishedHolds } from "./keep-awake";
import { tryAcquireProcessDirectoryLock } from "./process-lock";
import { getAllowedScripts, getRun, getRunLogPayload, isAnyScriptRunning, startRun, type AllowedScript } from "./runs/runner";
import { cancelWake, scheduleWake, wakeHelperStatus } from "../domains/scheduler/wake-helper";

export type { AgentJobSpec, Job, JobInput, JobWithNext, WakeState } from "../../../../packages/shared/scheduler/contracts";
export const { listJobs, getJob, validateCron, createJob, updateJob, approveJob, deleteJob, triggerNow, runSchedulerTick, getWakeState, startScheduler } = createScheduler({ dispatchAgentRun, isActiveAgentRunState, readAgentRun, writeAtomicNow, holdAwake, releaseFinishedHolds, tryAcquireProcessDirectoryLock, getAllowedScripts, getRun, getRunLogPayload, isAnyScriptRunning, startRun: script => startRun(script as AllowedScript), cancelWake, scheduleWake, wakeHelperStatus });
