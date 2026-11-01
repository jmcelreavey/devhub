export const TASK_AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "paused",
  "done",
  "failed",
  "abandoned",
] as const;

export type TaskAgentRunStatus = (typeof TASK_AGENT_RUN_STATUSES)[number];

export type TaskPrState = "open" | "merged" | "closed";

/** Something on the run's PR that the agent should be sent back for. */
export interface TaskPrAttention {
  kind: "ci-failing" | "changes-requested" | "new-comments";
  /** One or two lines: failing check names, or the latest comment excerpt. */
  summary: string;
  detectedAt: string;
  /** kind + head commit + summary — a dismissal holds until this changes. */
  key: string;
}

export type TaskRunRole = "plan" | "implement" | "verify" | "review" | "discuss";

export interface TaskAgentRunRecord {
  runId: string;
  /** Missing on legacy records, which were implementation-only. */
  role?: TaskRunRole;
  codeFingerprint?: string;
  status: TaskAgentRunStatus;
  provider?: string;
  /** Model the run was launched with; blank means the provider's default. */
  model?: string;
  /** Model tier the run used for its step, when it ran on one. */
  tier?: { step: string; tier: string };
  startedAt: string;
  updatedAt: string;
  prUrl?: string;
  branch?: string;
  /** Checkout the run worked in, retained as handoff context. */
  cwd?: string;
  sessionId?: string;
  terminalSessionId?: string;
  /** Last PR state the watcher saw (task-pr-watch.ts). */
  prState?: TaskPrState;
  prCheckedAt?: string;
  /** PR activity up to here has been seen (or acted on) — newer comments raise attention. */
  prSeenAt?: string;
  attention?: TaskPrAttention;
  /** Attention key the user dismissed or already sent the agent back for. */
  attentionHandled?: string;
}

export interface TaskAgentRunsFile {
  version: 1;
  taskId: string;
  handoff: string;
  handoffUpdatedAt?: string;
  runs: TaskAgentRunRecord[];
}

export type TaskAgentRunSummaries = Record<string, { handoff: string; latestRun: TaskAgentRunRecord | null }>;
