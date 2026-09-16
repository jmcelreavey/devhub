/**
 * Where every open task stands in the plan loop:
 * draft → ready → running → PR (needs a fix / waiting on merge) → merged.
 *
 * One pass over today's open tasks and their agent-run sidecars; the PR fields
 * come from the watcher (task-pr-watch.ts), so this makes no network calls.
 */
import { todayISO } from "@/lib/utils";
import { getTasks } from "@/lib/tasks/storage";
import { isTaskOpen, type Task } from "@/lib/tasks/types";
import {
  isActiveTaskAgentRunStatus,
  listTaskAgentRuns,
  type TaskAgentRunRecord,
} from "@/lib/tasks/task-agent-runs";
import { canResumeTaskAgentRun } from "@/lib/tasks/task-agent-resume";
import { collectOpenPrerequisiteBlockers } from "@/lib/tasks/implement-ready-gather";
import {
  PLAN_STATUS_BUCKETS,
  PLAN_STATUS_LABELS,
  type PlanStatus,
  type PlanStatusBucket,
  type PlanStatusItem,
} from "@/lib/tasks/plan-status-labels";

export { PLAN_STATUS_BUCKETS, PLAN_STATUS_LABELS };
export type { PlanStatus, PlanStatusBucket, PlanStatusItem };

/** Pure bucketing for one task — exported for tests. */
export function planStatusBucket(
  task: Task,
  latest: TaskAgentRunRecord | null,
  blockers: number,
): { bucket: PlanStatusBucket; detail?: string } {
  if (latest && isActiveTaskAgentRunStatus(latest.status)) return { bucket: "running" };
  if (latest?.attention) return { bucket: "needsFix", detail: latest.attention.summary };
  if (latest?.prState === "merged") return { bucket: "mergedToClose" };
  if (latest?.prState === "closed") return { bucket: "closedToDecide" };
  if (latest?.prState === "open") return { bucket: "waitingOnMerge" };
  if (latest && canResumeTaskAgentRun(latest.status, latest.sessionId)) {
    return { bucket: "resumable", detail: latest.status };
  }
  if (blockers > 0) return { bucket: "blocked", detail: `${blockers} open prerequisite(s)` };
  if (task.stage === "draft") return { bucket: "drafts" };
  return { bucket: "readyToDispatch" };
}

export function buildPlanStatus(date = todayISO()): PlanStatus {
  const status = { date } as PlanStatus;
  for (const bucket of PLAN_STATUS_BUCKETS) status[bucket] = [];
  for (const task of getTasks(date).filter(isTaskOpen)) {
    const latest = listTaskAgentRuns(task.id)[0] ?? null;
    // Only pay for the prerequisite scan when nothing more specific applies.
    const blockers = latest ? 0 : collectOpenPrerequisiteBlockers(task.id, task.links).length;
    const { bucket, detail } = planStatusBucket(task, latest, blockers);
    status[bucket].push({
      taskId: task.id,
      date,
      text: task.text,
      ...(latest ? { runId: latest.runId } : {}),
      ...(latest?.prUrl ? { prUrl: latest.prUrl } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  return status;
}

/** Plain-text report for MCP and the briefing. */
export function formatPlanStatus(status: PlanStatus): string {
  const lines = [`Plan status for ${status.date}`];
  for (const bucket of PLAN_STATUS_BUCKETS) {
    const items = status[bucket];
    if (items.length === 0) continue;
    lines.push("", `${PLAN_STATUS_LABELS[bucket]} (${items.length})`);
    for (const item of items) {
      const extra = [item.detail, item.prUrl].filter(Boolean).join(" · ");
      lines.push(`- ${item.text} [${item.taskId}]${extra ? ` — ${extra}` : ""}`);
    }
  }
  if (lines.length === 1) lines.push("", "No open tasks.");
  return lines.join("\n");
}

export interface PlanStatusGroup {
  bucket: PlanStatusBucket;
  label: string;
  items: Array<Pick<PlanStatusItem, "text" | "detail" | "prUrl">>;
}

/** Non-empty buckets only, most urgent first — for the briefing canvas and widget. */
export function planStatusGroups(status: PlanStatus): PlanStatusGroup[] {
  return PLAN_STATUS_BUCKETS.filter((bucket) => status[bucket].length > 0).map((bucket) => ({
    bucket,
    label: PLAN_STATUS_LABELS[bucket],
    items: status[bucket].map(({ text, detail, prUrl }) => ({
      text,
      ...(detail ? { detail } : {}),
      ...(prUrl ? { prUrl } : {}),
    })),
  }));
}
