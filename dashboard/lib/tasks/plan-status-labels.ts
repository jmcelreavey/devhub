/** Plan-loop buckets and labels — no server imports, so client components can use them. */

export const PLAN_STATUS_BUCKETS = [
  "needsFix",
  "mergedToClose",
  "closedToDecide",
  "running",
  "waitingOnMerge",
  "resumable",
  "blocked",
  "readyToDispatch",
  "drafts",
] as const;

export type PlanStatusBucket = (typeof PLAN_STATUS_BUCKETS)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatusBucket, string> = {
  needsFix: "PR needs a fix",
  mergedToClose: "Merged — complete the task",
  closedToDecide: "PR closed — abandon or reopen",
  running: "Agent running",
  waitingOnMerge: "Waiting on merge",
  resumable: "Stopped — resume when ready",
  blocked: "Blocked by a prerequisite",
  readyToDispatch: "Ready to hand to an agent",
  drafts: "Drafts to write up",
};

export interface PlanStatusItem {
  taskId: string;
  date: string;
  text: string;
  runId?: string;
  prUrl?: string;
  detail?: string;
}

export type PlanStatus = { date: string } & Record<PlanStatusBucket, PlanStatusItem[]>;
