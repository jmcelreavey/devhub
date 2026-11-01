import type { QaRunRecord } from "../../qa/run-types.ts";

export interface JevMedia {
  url: string;
  phase: "before" | "after";
}

/** What a board card shows about the Jev QA runs for one task. */
export interface JevInfo {
  runId: string;
  title: string;
  status: "running" | "passed" | "failed" | "blocked" | "cancelled";
  capturedAt: string;
  /** Failed goals plus runner errors: what Jev would file as bugs. */
  bugCount: number;
  goalsPassed: number;
  goalsTotal: number;
  madeModelDecision?: boolean;
  madeJevDecision?: boolean;
  receiptHref: string;
  beforeVideo: string | null;
  afterVideo: string | null;
  /** Newest capture, after > before. */
  screenshot: JevMedia | null;
  /** Estimated model spend for the review run, when Jev knows it. */
  costUsd?: number;
  tokens?: number;
}

export function qaMadeModelDecision(receipt: NonNullable<QaRunRecord["receipt"]>): boolean {
  return receipt.steps.some((step) => typeof step.confidence === "number" && Number.isFinite(step.confidence));
}

export function qaMadeJevDecision(receipt: NonNullable<QaRunRecord["receipt"]>): boolean {
  return receipt.steps.some((step) => typeof step.confidence === "number" && Number.isFinite(step.confidence) && step.calls?.at(-1)?.provider === "typesafe");
}

export function qaBugCount(run: QaRunRecord): number {
  const receipt = run.receipt;
  return receipt ? Math.min(999, receipt.goals.filter((goal) => !goal.passed).length + receipt.errors.length) : 0;
}

export function jevFailingGoals(run: QaRunRecord): string[] {
  const receipt = run.receipt;
  if (!receipt) return [];
  const goals = receipt.goals.slice(0, 30).flatMap((goal, index) => goal.passed ? [] : [`Assertion ${index + 1} failed`]);
  if (receipt.goals.slice(30).some((goal) => !goal.passed)) goals.push("Additional assertions failed");
  if (receipt.errors.length) {
    const count = Math.min(999, receipt.errors.length);
    goals.push(`Runner reported ${count} error${count === 1 ? "" : "s"}`);
  }
  return goals;
}

export function qaFailureCategory(receipt: NonNullable<QaRunRecord["receipt"]>): string {
  if (receipt.status === "cancelled") return "QA was cancelled.";
  if (receipt.stopReason.startsWith("QA failed during browser setup: QA_PREVIEW_UNAVAILABLE ")) return "The managed task preview stopped or its configuration changed.";
  switch (receipt.stopReason) {
    case "time-budget": return "The QA time limit was reached.";
    case "assertion-wait-budget": return "Assertions did not pass within the wait limit.";
    case "step-budget": return "The QA step limit was reached.";
    case "suspected-soft-lock": return "QA stopped after repeated stalled observations.";
    case "TYPESAFE_API_KEY is not configured.": return "QA provider credentials are unavailable.";
    case "QA vision needs an HTTP AI provider and a screenshot.": return "The QA vision fallback is unavailable.";
    case "evidence-incomplete": return "QA evidence capture was incomplete.";
    case "QA receipt has no verified goals or contains a failed goal.": return "The QA receipt has no verified goals or contains a failed assertion.";
    case "QA run or finished receipt is missing.": return "The finished QA receipt is missing.";
    case "The managed task preview stopped or its configuration changed. Start it again before retrying QA.": return "The managed task preview stopped or its configuration changed.";
    default: return receipt.status === "failed" ? "QA assertions did not pass." : "The QA runner could not complete.";
  }
}

function mediaUrl(runId: string, file: string): string {
  return `/api/qa/runs/${runId}/media/${encodeURIComponent(file)}`;
}

/** Failed-run captures count as "after": they are what the run ended on. */
function phaseOf(phase: string): "before" | "after" {
  return phase === "before" ? "before" : "after";
}

function mediaOf(run: QaRunRecord, kind: "image" | "video", phase: "before" | "after"): string | null {
  const artifact = run.receipt?.artifacts.find((item) => item.kind === kind && phaseOf(item.phase) === phase);
  return artifact ? mediaUrl(run.id, artifact.file) : null;
}

/**
 * Jev info per task from its QA runs (any order). The newest finished non-baseline
 * run supplies status and bugs; the "before" video is the task-start baseline
 * recording when there is one, else that run's own before video.
 */
export function jevInfoByTask(runs: QaRunRecord[]): Map<string, JevInfo> {
  const byTask = new Map<string, QaRunRecord[]>();
  for (const run of runs) {
    if (!run.taskId) continue;
    byTask.set(run.taskId, [...(byTask.get(run.taskId) ?? []), run]);
  }
  const out = new Map<string, JevInfo>();
  for (const [taskId, taskRuns] of byTask) {
    const newestFirst = [...taskRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = newestFirst.find((run) => !run.baseline);
    if (!latest) continue;
    const baselineVideo = newestFirst.filter((run) => run.baseline && run.state === "finished").map((run) => mediaOf(run, "video", "after") ?? mediaOf(run, "video", "before")).find(Boolean) ?? null;
    const receipt = latest.receipt;
    if (latest.state === "running" || !receipt) {
      out.set(taskId, {
        runId: latest.id, title: "QA", status: latest.state === "running" ? "running" : "blocked", capturedAt: latest.createdAt,
        bugCount: 0, goalsPassed: 0, goalsTotal: 0, receiptHref: `/qa?run=${latest.id}&task=${encodeURIComponent(taskId)}`,
        beforeVideo: baselineVideo, afterVideo: null, screenshot: null,
      });
      continue;
    }
    const afterImage = mediaOf(latest, "image", "after");
    const beforeImage = mediaOf(latest, "image", "before");
    out.set(taskId, {
      runId: latest.id,
      title: receipt.title,
      status: receipt.status,
      capturedAt: receipt.endedAt || receipt.startedAt,
      bugCount: qaBugCount(latest),
      goalsPassed: receipt.goals.filter((goal) => goal.passed).length,
      goalsTotal: receipt.goals.length,
      madeModelDecision: qaMadeModelDecision(receipt),
      madeJevDecision: qaMadeJevDecision(receipt),
      receiptHref: `/qa?run=${latest.id}&task=${encodeURIComponent(taskId)}`,
      beforeVideo: baselineVideo ?? mediaOf(latest, "video", "before"),
      afterVideo: mediaOf(latest, "video", "after"),
      screenshot: afterImage ? { url: afterImage, phase: "after" } : beforeImage ? { url: beforeImage, phase: "before" } : null,
      ...(receipt.totals?.estimatedCostUsd > 0 ? { costUsd: receipt.totals.estimatedCostUsd } : {}),
      ...(receipt.totals && receipt.totals.inputTokens + receipt.totals.outputTokens > 0 ? { tokens: receipt.totals.inputTokens + receipt.totals.outputTokens } : {}),
    });
  }
  return out;
}
