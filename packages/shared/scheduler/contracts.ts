export interface AgentJobSpec {
  provider: string;
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
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
  script?: string;
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

export type JobInput = Pick<Job, "name" | "cron"> &
  Partial<Pick<Job, "enabled" | "wake" | "script" | "agent">>;
