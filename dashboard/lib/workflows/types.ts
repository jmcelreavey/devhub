export const WORKFLOW_STAGES = ["plan", "implement", "verify", "review", "approve", "draft-pr"] as const;
export type WorkflowStage = typeof WORKFLOW_STAGES[number];
export type WorkflowStatus = "active" | "waiting-user" | "blocked" | "paused" | "complete" | "abandoned";

export interface WorkflowCheck {
  id: string;
  runId: string;
  fingerprint: string;
  command: string;
  startedAt: string;
  finishedAt?: string;
  exitCode: number | null;
  executionStarted?: boolean;
  stale?: boolean;
  outcome: "running" | "passed" | "failed" | "interrupted";
  detail?: string;
}
export interface WorkflowReview {
  runId: string;
  stale?: boolean;
  fingerprint: string;
  findings: string;
  verdict: "pass" | "changes-requested";
  recordedAt: string;
}
export interface WorkflowProposal {
  id: string;
  kind: "commit-push" | "draft-pr" | "ticket-transition" | "task-completion";
  runId: string;
  fingerprint: string;
  destination: string;
  content: string;
  contentHash: string;
  expiresAt: string;
  state: "pending" | "approved" | "rejected" | "stale" | "outcome-unknown" | "succeeded" | "failed";
}
export interface WorkflowEvent {
  id: string;
  at: string;
  summary: string;
}
export interface TaskWorkflow {
  version: 1;
  taskId: string;
  revision: number;
  stage: WorkflowStage;
  status: WorkflowStatus;
  checks: WorkflowCheck[];
  reviews: WorkflowReview[];
  proposals: WorkflowProposal[];
  events: WorkflowEvent[];
  seenRevision: number;
  runStates?: Record<string, { state: string; at: number }>;
}
