import type { TaskAgentRunStatus, TaskRunRole } from "../../tasks/agent-runs.ts";
import { PREVIEW_OWNERSHIP_REFUSED } from "./types.ts";
import type { AutoPhase, AutoWaiting, ExecutionStep, OrchestrationRecord, OrchestrationStatus } from "./types.ts";

/** Client-safe orchestration helpers: labels, chips and the role → step map. No file access. */

export const STEP_LABEL: Record<ExecutionStep, string> = {
  plan: "Plan",
  implement: "Implement",
  verify: "Verify",
  "draft-pr": "Open PR",
};

export const ORCHESTRATION_STATUS_LABEL: Record<OrchestrationStatus, string> = {
  starting: "Starting",
  running: "On auto",
  "needs-you": "Needs you",
  paused: "Paused",
  "pr-created": "PR ready",
  stopped: "Stopped",
  "paused-manual": "Manual",
  "ready-for-review": "Ready for review",
};

/** Auto mode's phases as the card shows them. */
export const AUTO_PHASE_LABEL: Record<AutoPhase, string> = {
  plan: "Plan",
  baseline: "Before video",
  implement: "Implement",
  "draft-pr": "Open PR",
  verify: "Review + QA",
  fix: "Fix",
  ready: "Ready for review",
};

/** Auto mode's state as cards and MCP see it. */
export interface AutoSummary {
  pauseAfterPlan?: boolean;
  createPr?: boolean;
  planRunId?: string;
  phase: AutoPhase;
  round: number;
  maxRounds: number;
  waiting?: Pick<AutoWaiting, "kind" | "reason">;
  /** The runs it dispatched (newest last): phase, round, tier and why. */
  runs: Array<{ runId: string; phase: AutoPhase; round: number; attempt?: number; at?: string; tier?: string; tierReason?: string }>;
  ui?: { detected: boolean; reason: string; override?: boolean };
  preview?: { state: "url" | "started" | "starting" | "none"; url?: string; reason: string };
  /** Why Jev did not run in this verify (not a UI change, or no preview). */
  qaSkipped?: string;
  baselineIssue?: string;
}

/** Discuss is planning; review is part of verifying. The run's role is the source of truth for its step. */
export function stepForRole(role: TaskRunRole | undefined): ExecutionStep {
  switch (role) {
    case "plan":
    case "discuss":
      return "plan";
    case "verify":
    case "review":
      return "verify";
    default:
      return "implement";
  }
}

/** What a list of orchestrations exposes to task rows and the Storyboard header. */
export interface OrchestrationSummary {
  taskId: string;
  taskDate: string;
  status: OrchestrationStatus;
  executionStep: ExecutionStep;
  openQuestions: number;
  /** An open `repo` question: DevHub could not tell which checkout to run in. Only this shows Choose repo. */
  waitingOnRepo?: true;
  runCount: number;
  prUrl?: string;
  lastError?: string;
  /** Status of the newest run this orchestration dispatched, from the task's run sidecar. */
  latestRunStatus?: TaskAgentRunStatus;
  /** Checkout vs worktree for the latest dispatch, with why. */
  checkout?: { mode: "checkout" | "worktree"; reason: string };
  repoName?: string;
  /** Tiers chosen at kickoff, for per-card tier labels. */
  tiers?: import("./model-tiers-shared.ts").ModelTierSettings;
  /** Present once the task runs on auto mode (M1); older records advance only when retried. */
  auto?: AutoSummary;
  updatedAt: string;
}

/**
 * On auto, the plan's checkout choice is made before the plan exists and Build decides again with it, so
 * the label would flip mid-run. Show only Build's decision, which then holds for the rest of the run.
 */
function stableCheckout(record: OrchestrationRecord): boolean {
  if (!record.checkout) return false;
  return !record.auto || record.auto.runs.some((run) => run.phase === "implement");
}

const SAFE_PREVIEW_REASONS = new Set([
  PREVIEW_OWNERSHIP_REFUSED,
  "The task has no repo to start a managed preview from.",
  "The task's repo name is not valid for a managed preview.",
  "The repo has no upstarts/<repo>/preview.json.",
  "The managed preview config could not be read; check its permissions.",
  "The managed preview config is not valid JSON.",
  "The managed preview config is invalid; check its fields.",
  "The managed preview config has autoStart off.",
  "No checkout to start the preview from.",
  "Starting the preview.",
  "Starting the managed preview.",
  "Waiting for the managed preview to become ready.",
  "The managed preview is running.",
  "The managed preview could not start. Check its configured command and dependencies.",
  "The managed preview failed. Check its configured command and retry.",
  "The managed preview could not allocate a local port. Check its configuration and retry.",
  "The managed preview readiness check failed. Check its configuration and retry.",
  "The managed preview configuration or checkout changed. Start it again before retrying QA.",
  "The managed preview configuration changed. Start it again before retrying QA.",
  "The isolated static preview is running.",
  "The managed preview changed or stopped. Retry QA.",
  "Automatic QA requires an isolated static preview. Command-based previews cannot prove connection ownership.",
  "Static previews require a directory and cannot specify a command or port.",
  "No checkout to serve the static preview from.",
  "The static preview directory must exist inside the checkout.",
  "Starting the isolated static preview.",
  "The managed preview was stopped before it could start.",
  "The isolated static preview could not bind a local listener.",
  "The managed preview could not bind a local listener.",
  "The managed preview checkout does not exist.",
  "The managed preview did not become ready; check its command, loopback binding and connection ownership.",
  "Command-based previews must use {port}; fixed ports cannot prove connection ownership.",
  "Command previews require explicit trustCommand opt-in.",
  "Command previews require lsof and Unix process groups for connection ownership.",
]);

function safePreviewReason(reason: string): string {
  if (SAFE_PREVIEW_REASONS.has(reason)) return reason;
  if (/^Port [0-9]{1,5} configured for the managed preview is already in use\.$/.test(reason)) return reason;
  if (/^The managed preview exited \(exit [0-9]{1,3}\)\. Check its configured command and retry\.$/.test(reason)) return reason;
  if (/^The managed preview did not become ready within [0-9]{1,3}s\. Check its configuration and retry\.$/.test(reason)) return reason;
  if (reason.startsWith("The preview command exited")) return "The managed preview exited. Check its configured command and retry.";
  if (reason.startsWith("The preview command failed to start")) return "The managed preview could not start. Check its configured command and dependencies.";
  return "The managed preview is unavailable. Check its configuration and retry.";
}

function safeNoPreview(reason: string): string {
  if (!reason.startsWith("No preview: ")) return reason;
  const detail = reason.slice("No preview: ".length).split(" Opt in to a DevHub-managed repo preview", 1)[0];
  return `No preview: ${safePreviewReason(detail)} Opt in to a DevHub-managed repo preview, then re-run QA.`;
}

function safeBaselineIssue(issue: string): string {
  const prefix = "Before capture incomplete: No preview: ";
  if (!issue.startsWith(prefix)) return issue;
  const detail = issue.slice(prefix.length).split(/ Opt in to a DevHub-managed repo preview| Capture it manually/, 1)[0];
  return `${prefix}${safePreviewReason(detail)} Capture it manually against the base checkout.`;
}

export function summariseOrchestration(record: OrchestrationRecord, latestRunStatus?: TaskAgentRunStatus): OrchestrationSummary {
  const skipped = record.auto?.verify?.qaSkipped;
  const safeSkipped = skipped ? safeNoPreview(skipped) : undefined;
  const lastError = record.lastError && skipped?.startsWith("No preview: ") && safeSkipped && record.lastError.startsWith("Auto mode finished.")
    ? `Auto mode finished. ${record.auto?.verify?.reviewDone ? "Review done" : "No review recorded"}; QA didn't run (${safeSkipped.replace(/\.$/, "")}). Check the work before you rely on it.`
    : record.lastError;
  return {
    taskId: record.taskId,
    taskDate: record.taskDate,
    status: record.status,
    executionStep: record.executionStep,
    openQuestions: record.questions.filter((question) => question.state === "open").length,
    ...(record.questions.some((question) => question.kind === "repo" && question.state === "open") ? { waitingOnRepo: true as const } : {}),
    runCount: record.runIds.length,
    ...(record.terminal?.prUrl ? { prUrl: record.terminal.prUrl } : {}),
    ...(lastError ? { lastError } : {}),
    ...(latestRunStatus ? { latestRunStatus } : {}),
    ...(stableCheckout(record) ? { checkout: { mode: record.checkout!.mode, reason: record.checkout!.reason } } : {}),
    ...(record.repo?.name ? { repoName: record.repo.name } : {}),
    ...(record.tiers ? { tiers: record.tiers } : {}),
    ...(record.auto ? {
      auto: {
        ...(record.auto.pauseAfterPlan !== undefined ? { pauseAfterPlan: record.auto.pauseAfterPlan } : {}),
        ...(record.auto.createPr !== undefined ? { createPr: record.auto.createPr } : {}),
        ...(record.auto.waiting?.kind === "plan-approval" ? { planRunId: record.auto.runs.filter((run) => run.phase === "plan" && run.attempt === record.auto!.attempt).at(-1)?.runId } : {}),
        phase: record.auto.phase,
        round: record.auto.round,
        maxRounds: record.auto.maxRounds,
        ...(record.auto.waiting ? { waiting: { kind: record.auto.waiting.kind, reason: record.auto.waiting.reason } } : {}),
        runs: record.auto.runs.slice(-24).map((run) => ({ runId: run.runId, phase: run.phase, round: run.round, attempt: run.attempt, at: run.at, ...(run.tier ? { tier: run.tier } : {}), ...(run.tierReason ? { tierReason: run.tierReason } : {}) })),
        ...(record.auto.ui ? { ui: record.auto.ui } : {}),
        ...(record.auto.preview ? { preview: { ...record.auto.preview, reason: safePreviewReason(record.auto.preview.reason) } } : {}),
        ...(safeSkipped ? { qaSkipped: safeSkipped } : {}),
        ...(record.auto.baselineIssue ? { baselineIssue: safeBaselineIssue(record.auto.baselineIssue) } : {}),
      },
    } : {}),
    updatedAt: record.updatedAt,
  };
}

/** Stopped orchestrations stay on disk for the record but no longer claim the task. */
export function isOrchestrating(status: OrchestrationStatus): boolean {
  return status !== "stopped";
}

/**
 * The Auto/Manual switch applies while the task is on auto and not finished.
 * With no runs yet there's nothing to stop, and Manual -> Auto just lands
 * back on the same question, so the switch stays hidden until a run exists.
 */
export function canSwitchMode(summary: Pick<OrchestrationSummary, "status" | "runCount">): boolean {
  if (summary.runCount === 0 || summary.status === "ready-for-review") return false;
  return summary.status === "paused-manual" || summary.status === "running" || summary.status === "starting" || summary.status === "needs-you" || summary.status === "paused";
}

export function isManual(summary: Pick<OrchestrationSummary, "status">): boolean {
  return summary.status === "paused-manual";
}

export function checkoutLabel(choice: { mode: "checkout" | "worktree"; reason: string }): string {
  return `${choice.mode === "worktree" ? "Worktree" : "Checkout"}: ${choice.reason}`;
}

/** The task's card on the board; the page scrolls to it and highlights it. */
export function storyboardHrefForTask(taskId: string): string {
  return `/storyboard?task=${encodeURIComponent(taskId)}`;
}

/** Task-row chip. Reuses the existing chip kinds so it sits with the agent chip visually. */
export function orchestrationChip(summary: OrchestrationSummary): { label: string; kind: "running" | "paused" | "ready"; detail: string } | null {
  if (!isOrchestrating(summary.status)) return null;
  if (summary.status === "needs-you" && summary.auto?.waiting?.kind === "plan-approval") return { label: "Plan ready", kind: "ready", detail: "Approve the plan to continue on Auto, or request a revision." };
  const step = STEP_LABEL[summary.executionStep];
  switch (summary.status) {
    case "needs-you":
      return { label: "Needs you", kind: "paused", detail: `${summary.openQuestions || 1} open question${summary.openQuestions === 1 ? "" : "s"} at ${step}` };
    case "paused":
      return { label: "Paused", kind: "paused", detail: summary.lastError ? `Couldn't start ${step}: ${summary.lastError}` : `Paused at ${step}` };
    case "paused-manual":
      return { label: "Manual", kind: "paused", detail: summary.lastError ? `${summary.lastError} Switch to Auto to retry.` : `Switched to Manual at ${step}. Switch back to Auto to resume.` };
    case "pr-created":
      return { label: "PR ready", kind: "ready", detail: "PR opened for review. Review it before merging." };
    case "ready-for-review":
      return { label: "Ready for review", kind: "ready", detail: "Auto mode finished. Check what review and QA actually covered before relying on it." };
    case "running":
      if (summary.auto) return { label: "On auto", kind: "running", detail: `On auto · ${AUTO_PHASE_LABEL[summary.auto.phase]}${summary.auto.round ? ` · fix round ${summary.auto.round}/${summary.auto.maxRounds}` : ""}` };
      // Phase 1 does not advance steps by itself: once the step's run settles, say so instead of "On auto".
      if (summary.latestRunStatus && !["queued", "running"].includes(summary.latestRunStatus)) {
        return { label: `${step} ${summary.latestRunStatus}`, kind: summary.latestRunStatus === "done" ? "ready" : "paused", detail: `${step} run ${summary.latestRunStatus}. Review it on Storyboard; automatic step advance is not built yet.` };
      }
      return { label: "On auto", kind: "running", detail: `On auto · ${step}` };
    default:
      return { label: "On auto", kind: "running", detail: `${ORCHESTRATION_STATUS_LABEL[summary.status]} · ${step}` };
  }
}
