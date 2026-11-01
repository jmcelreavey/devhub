import { z } from "zod";
import { defineAction } from "./define.ts";

const taskId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const base = { taskId, revision: z.number().int().nonnegative() };
const verifyInput = z.object({ ...base, action: z.literal("verify") });
const reviewInput = z.object({ ...base, action: z.literal("review").default("review"), runId: z.string().min(1).max(100), verdict: z.enum(["pass", "changes-requested"]), findings: z.string().trim().min(1).max(20000) }).meta({ additionalProperties: false });
const proposeInput = z.object({ ...base, action: z.literal("propose"), kind: z.enum(["commit-push", "draft-pr", "ticket-transition", "task-completion"]), destination: z.string().trim().min(1).max(1000), content: z.string().trim().min(1).max(20000) });
const decideInput = z.object({ ...base, action: z.literal("decide"), proposalId: z.string().uuid(), approve: z.boolean() });
const statusInput = z.object({ ...base, action: z.literal("status"), status: z.enum(["active", "paused", "abandoned"]) });
const seenInput = z.object({ ...base, action: z.literal("seen") });
const unseenInput = z.object({ ...base, action: z.literal("unseen") });
const beginInput = z.object({ ...base, action: z.literal("begin"), proposalId: z.string().uuid() });
const receiptInput = z.object({ ...base, action: z.literal("receipt"), proposalId: z.string().uuid(), succeeded: z.boolean(), detail: z.string().trim().min(1).max(2000) });

export const workflowActionSchema = z.discriminatedUnion("action", [
  verifyInput, reviewInput.extend({ action: z.literal("review"), runId: z.string() }), proposeInput, decideInput,
  statusInput, seenInput, unseenInput, beginInput, receiptInput,
]);
export type WorkflowActionInput = z.output<typeof workflowActionSchema>;

export type WorkflowOutcome =
  | { ok: true; value: unknown; status: number }
  | { ok: false; error: string; status: number };

export interface WorkflowReadContext {
  read: (taskId?: string) => Promise<WorkflowOutcome>;
}

export interface WorkflowWriteContext {
  execute: (input: WorkflowActionInput) => Promise<WorkflowOutcome>;
}

const workflowReadInput = z.object({ taskId: taskId.optional() }).meta({ additionalProperties: false });

export {
  workflowReadInput as taskWorkflowGetInput,
  verifyInput as taskWorkflowVerifyInput,
  reviewInput as taskWorkflowReviewInput,
  proposeInput as taskWorkflowProposeInput,
  decideInput as taskWorkflowDecideInput,
  statusInput as taskWorkflowStatusInput,
  seenInput as taskWorkflowSeenInput,
  unseenInput as taskWorkflowUnseenInput,
  beginInput as taskWorkflowBeginInput,
  receiptInput as taskWorkflowReceiptInput,
};

export const taskWorkflowGet = defineAction<typeof workflowReadInput, WorkflowReadContext, WorkflowOutcome>({
  input: workflowReadInput,
  http: { method: "GET", path: "/api/tasks/workflow" },
  mcp: { name: "tasks_workflow_get", toolset: "tasks", description: "Read durable task checks, independent reviews, approval proposals, decisions and unread events, optionally for one task. The dashboard reconciles run history and stale code evidence; it never reruns an interrupted check. Explicit human approval can come from chat or Task workflows; record the user's chat instruction in the task note and its decision through POST /api/tasks/workflow before executing the approved action." },
  handler: ({ taskId: id }, context) => context.read(id),
});

export const taskWorkflowReview = defineAction<typeof reviewInput, WorkflowWriteContext, WorkflowOutcome>({
  input: reviewInput,
  http: { method: "POST", path: "/api/tasks/workflow", discriminator: "body action=review" },
  mcp: { name: "tasks_workflow_review", toolset: "tasks", description: "Record findings and verdict from a completed independent reviewer linked to this task. Requires the latest workflow revision, passing checks and an unchanged code fingerprint. Does not approve a proposal, commit, push or mark the task done. Refresh after a conflict; never invent a review." },
  handler: (input, context) => context.execute(input),
});

function dashboardWorkflowAction<Schema extends z.ZodObject>(input: Schema, action: string) {
  return defineAction<Schema, WorkflowWriteContext, WorkflowOutcome>({
    input,
    http: { method: "POST", path: "/api/tasks/workflow", discriminator: `body action=${action}` },
    mcp: { reason: "Workflow decisions and execution controls remain dashboard-only." },
    handler: (value, context) => context.execute(value as WorkflowActionInput),
  });
}

export const taskWorkflowVerify = dashboardWorkflowAction(verifyInput, "verify");
export const taskWorkflowPropose = dashboardWorkflowAction(proposeInput, "propose");
export const taskWorkflowDecide = dashboardWorkflowAction(decideInput, "decide");
export const taskWorkflowStatus = dashboardWorkflowAction(statusInput, "status");
export const taskWorkflowSeen = dashboardWorkflowAction(seenInput, "seen");
export const taskWorkflowUnseen = dashboardWorkflowAction(unseenInput, "unseen");
export const taskWorkflowBegin = dashboardWorkflowAction(beginInput, "begin");
export const taskWorkflowReceipt = dashboardWorkflowAction(receiptInput, "receipt");
