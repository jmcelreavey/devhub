/**
 * Orchestrator data contract. The board itself is a view over task notes
 * (see notes-board.ts) and owns no state; only the auto-mode orchestrator
 * keeps a record per task.
 */

/**
 * Orchestrator steps. They map onto the existing workflow stages (review and
 * approve are folded into verify / draft-pr), never a parallel stage list.
 */
export const EXECUTION_STEPS = ["plan", "implement", "verify", "draft-pr"] as const;
export type ExecutionStep = (typeof EXECUTION_STEPS)[number];

export const ORCHESTRATION_SCHEMA_VERSION = 1;

/**
 * - `starting`: record written, first run not yet dispatched (or dispatch in flight).
 * - `running`: a step's run is in progress.
 * - `needs-you`: an open question blocks the next step.
 * - `paused`: dispatch failed (Paseo down, capacity); Start on auto retries.
 * - `pr-created`: terminal. Draft PR opened; supervised stop for review.
 * - `stopped`: the user stopped it.
 * - `paused-manual`: the user switched the task to Manual; the active run was cancelled. Switch back to Auto to resume.
 * - `ready-for-review`: auto mode finished: plan, implement, draft PR, review and Jev QA passed (lib/storyboard/auto-mode.ts).
 */
export const ORCHESTRATION_STATUSES = ["starting", "running", "needs-you", "paused", "pr-created", "stopped", "paused-manual", "ready-for-review"] as const;
export type OrchestrationStatus = (typeof ORCHESTRATION_STATUSES)[number];

export interface OrchestrationQuestion {
  id: string;
  stepId: ExecutionStep;
  /** `repo`: DevHub could not tell which checkout to run in. `blocker`: an agent asked (Phase 2). */
  kind: "repo" | "blocker";
  prompt: string;
  state: "open" | "answered";
  askedAt: string;
  answeredAt?: string;
  answer?: string;
}

/** Where a plan run works: the checkout itself, or an isolated worktree. Chosen per dispatch, with the reason. */
export interface OrchestrationCheckoutChoice {
  mode: "checkout" | "worktree";
  reason: string;
  decidedAt: string;
}

export interface OrchestrationTerminal {
  kind: "pr-created";
  at: string;
  prUrl?: string;
}

/**
 * Auto mode (M1) phases, in order. `baseline` records Jev's "before" video
 * before any code changes; `verify` is the code review plus Jev QA; `fix` is
 * a bounded loop back into verify.
 */
export const AUTO_PHASES = ["plan", "baseline", "implement", "draft-pr", "verify", "fix", "ready"] as const;
export type AutoPhase = (typeof AUTO_PHASES)[number];

/** Why auto mode stopped at Needs you (or is waiting for capacity). */
export interface AutoWaiting {
  /** `questions`: open questions in the note. `failure`: a run failed or could not start. `cap`: bugs left after the last fix round. `queued`: waiting for a heavy-job slot. */
  kind: "questions" | "failure" | "cap" | "queued" | "plan-approval";
  reason: string;
  at: string;
  /** Where auto mode goes once the questions are answered. */
  next?: AutoPhase;
}

/** One agent run auto mode dispatched, with the tier it asked for and why. */
export interface AutoRun {
  feedbackKey?: string;
  runId: string;
  phase: AutoPhase;
  round: number;
  attempt: number;
  tier?: "cheap" | "mid" | "heavy";
  tierReason?: string;
  at: string;
}

/** The persisted auto-mode state machine. Every transition is written under the record's lock, so it survives a restart. */
export interface AutoState {
  /** Unique per Start after reset; old dispatch/QA attempts must not be replayed. */
  cycleId?: string;
  feedbackKey?: string;
  feedbackBrief?: string;
  pauseAfterPlan?: boolean;
  recoveryGuidance?: { text: string; phase: AutoPhase; attempt: number };
  phase: AutoPhase;
  /** Fix rounds taken so far. */
  round: number;
  maxRounds: number;
  /** Retries of the current phase (a retry escalates the tier). */
  attempt: number;
  /** Dashboard origin the prompts point agents at. */
  origin: string;
  runs: AutoRun[];
  waiting?: AutoWaiting;
  /** Where the implementation lives once it ran: the checkout, or the run's worktree. */
  work?: { cwd: string; worktree?: { path: string; branch: string; repoRoot: string }; baseSha?: string };
  baselineQaRunId?: string;
  verify?: { reviewRunId?: string; reviewDone?: boolean; qaRunId?: string; qaDone?: boolean; qaBugs?: number; qaSkipped?: string };
  /** What the last verify found, handed to the fix run. */
  findings?: string[];
  /** Is this a UI change? `override` is the card toggle; it wins over detection. */
  ui?: { detected: boolean; reason: string; override?: boolean };
  /** Where Jev pointed: the task's preview URL, a dev server DevHub started (or is starting), or none (Jev skipped). */
  preview?: { state: "url" | "started" | "starting" | "none"; url?: string; reason: string };
}

/** On-disk orchestration: `notes/.config/storyboard/orchestrations/<taskId>.json`. One per task. */
export interface OrchestrationRecord {
  schemaVersion: typeof ORCHESTRATION_SCHEMA_VERSION;
  revision: number;
  taskId: string;
  /** Day file the task was started from; dispatch needs it to find the task. */
  taskDate: string;
  executionStep: ExecutionStep;
  status: OrchestrationStatus;
  /** Runs this orchestration dispatched, oldest first. Their step comes from the run's role. */
  runIds: string[];
  questions: OrchestrationQuestion[];
  terminal: OrchestrationTerminal | null;
  repo?: { name?: string; cwd?: string };
  /** Latest checkout-vs-worktree decision for a dispatched run. */
  checkout?: OrchestrationCheckoutChoice;
  /** Why the last dispatch failed, shown while `paused`. */
  lastError?: string;
  /** Model tiers chosen at kickoff; each step dispatches on its tier. */
  tiers?: import("./model-tiers-shared").ModelTierSettings;
  launchOptions?: import("./launch-options").AutoLaunchOptions;
  /** Auto mode's state machine. Records started before M1 have none and never advance on their own. */
  auto?: AutoState;
  createdAt: string;
  updatedAt: string;
  idempotency: Array<{ key: string; at: string }>;
}
