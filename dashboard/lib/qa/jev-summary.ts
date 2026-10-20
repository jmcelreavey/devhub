import type { QaRunRecord } from "./store";

export interface JevMedia {
  url: string;
  phase: "before" | "after";
}

/** What a board card shows about the Jev QA runs for one task. */
export interface JevInfo {
  runId: string;
  title: string;
  status: "passed" | "failed" | "blocked" | "cancelled";
  capturedAt: string;
  /** Failed goals plus runner errors: what Jev would file as bugs. */
  bugCount: number;
  goalsPassed: number;
  goalsTotal: number;
  receiptHref: string;
  beforeVideo: string | null;
  afterVideo: string | null;
  /** Newest capture, after > before. */
  screenshot: JevMedia | null;
  /** Estimated model spend for the review run, when Jev knows it. */
  costUsd?: number;
  tokens?: number;
}

export function qaBugCount(run: QaRunRecord): number {
  const receipt = run.receipt;
  return receipt ? receipt.goals.filter((goal) => !goal.passed).length + receipt.errors.length : 0;
}

/** What Jev would file: each failed goal with what it saw, then runner errors. */
export function jevFailingGoals(run: QaRunRecord): string[] {
  const receipt = run.receipt;
  if (!receipt) return [];
  const goals = receipt.goals.filter((goal) => !goal.passed).map((goal) => {
    const g = goal as { description?: string; id?: string; actual?: unknown };
    const actual = typeof g.actual === "string" && g.actual.trim() ? ` (saw: ${g.actual.trim().slice(0, 160)})` : "";
    return `${g.description ?? g.id ?? "goal"} failed${actual}`;
  });
  return [...goals, ...receipt.errors.map((error) => `runner error: ${String((error as { message?: unknown }).message ?? error).slice(0, 200)}`)];
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
    if (!run.taskId || !run.receipt) continue;
    byTask.set(run.taskId, [...(byTask.get(run.taskId) ?? []), run]);
  }
  const out = new Map<string, JevInfo>();
  for (const [taskId, taskRuns] of byTask) {
    const newestFirst = [...taskRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = newestFirst.find((run) => !run.baseline);
    if (!latest?.receipt) continue;
    const baselineVideo = newestFirst.filter((run) => run.baseline).map((run) => mediaOf(run, "video", "after") ?? mediaOf(run, "video", "before")).find(Boolean) ?? null;
    const afterImage = newestFirst.map((run) => mediaOf(run, "image", "after")).find(Boolean) ?? null;
    const beforeImage = newestFirst.map((run) => mediaOf(run, "image", "before")).find(Boolean) ?? null;
    const receipt = latest.receipt;
    out.set(taskId, {
      runId: latest.id,
      title: receipt.title,
      status: receipt.status,
      capturedAt: receipt.endedAt || receipt.startedAt,
      bugCount: qaBugCount(latest),
      goalsPassed: receipt.goals.filter((goal) => goal.passed).length,
      goalsTotal: receipt.goals.length,
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
