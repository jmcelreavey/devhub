import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listAgentRuns, readAgentRun } from "@/lib/agent-runs/store";
import { validateAgentCwd } from "@/lib/agent-runs/dispatch";
import { execExternal } from "@/lib/exec-external";
import { listTaskAgentRuns, latestImplementationRun, taskRunRole, upsertTaskAgentRun, patchTaskAgentRun, mapAgentRunStateToTaskStatus } from "@/lib/tasks/task-agent-runs";
import { contentHash, evidenceReady, invalidateEvidence, readWorkflow, recordWorkflowRun, updateWorkflow } from "./store";
import { readOrchestration } from "@/lib/storyboard/orchestration-store";
import { worktreeFingerprint } from "./fingerprint";
import type { TaskWorkflow } from "./types";

const base = { taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), revision: z.number().int().nonnegative() };
export const WorkflowAction = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("verify") }),
  z.object({ ...base, action: z.literal("review"), runId: z.string(), verdict: z.enum(["pass", "changes-requested"]), findings: z.string().trim().min(1).max(20000) }),
  z.object({ ...base, action: z.literal("propose"), kind: z.enum(["commit-push", "draft-pr", "ticket-transition", "task-completion"]), destination: z.string().trim().min(1).max(1000), content: z.string().trim().min(1).max(20000) }),
  z.object({ ...base, action: z.literal("decide"), proposalId: z.string().uuid(), approve: z.boolean() }),
  z.object({ ...base, action: z.literal("status"), status: z.enum(["active", "paused", "abandoned"]) }),
  z.object({ ...base, action: z.literal("seen") }),
  z.object({ ...base, action: z.literal("unseen") }),
  z.object({ ...base, action: z.literal("begin"), proposalId: z.string().uuid() }),
  z.object({ ...base, action: z.literal("receipt"), proposalId: z.string().uuid(), succeeded: z.boolean(), detail: z.string().trim().min(1).max(2000) }),
]);
export type WorkflowActionInput = z.infer<typeof WorkflowAction>;

export async function recoverWorkflowRuns(taskId: string, aliases: Set<string>): Promise<void> {
  for (const run of listAgentRuns(Number.MAX_SAFE_INTEGER).sort((a, b) => a.status.updatedAt - b.status.updatedAt)) {
    if (!run.spec.activity?.taskId || !aliases.has(run.spec.activity.taskId)) continue;
    await upsertTaskAgentRun({ taskId, runId: run.spec.id, role: taskRunRole(run.spec.activity.action), provider: run.spec.provider, startedAt: new Date(run.spec.createdAt).toISOString(), sessionId: run.status.sessionId, status: mapAgentRunStateToTaskStatus(run.status.state) });
    await patchTaskAgentRun(taskId, run.spec.id, { cwd: run.spec.cwd });
    await recordWorkflowRun({ ...run.spec, activity: { ...run.spec.activity, taskId } }, run.status);
  }
}

export function implementationForTask(taskId: string) {
  const linked = latestImplementationRun(listTaskAgentRuns(taskId));
  const run = linked ? readAgentRun(linked.runId) : null;
  if (!run) throw new Error("Start an implementation run before recording evidence.");
  // Auto mode pins one checkout for the whole task. Later draft-PR retries are also "implement" runs and can start elsewhere,
  // which changed the fingerprint and marked finished checks and reviews out of date.
  const pinned = readOrchestration(taskId)?.auto?.work;
  const pinnedCwd = pinned?.worktree?.path ?? pinned?.cwd;
  let cwd: string | null = null;
  if (pinnedCwd) { try { cwd = validateAgentCwd(pinnedCwd); } catch { cwd = null; } }
  return { run, cwd: cwd ?? validateAgentCwd(run.spec.cwd) };
}

/** Read-time recovery never reruns an uncertain command. */
export async function refreshWorkflowEvidence(taskId: string): Promise<TaskWorkflow> {
  const current = readWorkflow(taskId);
  if (!current.checks.length && !current.proposals.length) return current;
  let fingerprint: string;
  try {
    fingerprint = await worktreeFingerprint(implementationForTask(taskId).cwd);
  } catch {
    fingerprint = "checkout-unavailable";
  }
  return updateWorkflow(taskId, undefined, (state) => {
    const before = JSON.stringify(state);
    invalidateEvidence(state, fingerprint);
    for (const check of state.checks) {
      if (check.outcome === "running" && Date.parse(check.startedAt) < Date.now() - 660000) {
        check.outcome = "interrupted";
        check.finishedAt = new Date().toISOString();
        check.detail = "No completion was recorded. Inspect the checkout before running checks again.";
        if (!["paused", "complete", "abandoned"].includes(state.status)) state.status = "blocked";
      }
    }
    if (JSON.stringify(state) !== before) return "Evidence changed or verification was interrupted";
  });
}

export async function actOnWorkflow(input: WorkflowActionInput): Promise<{ workflow: TaskWorkflow; checkId?: string }> {
  if (input.action === "seen" || input.action === "unseen" || input.action === "status") {
    const workflow = await updateWorkflow(input.taskId, input.revision, (state) => {
      if (input.action === "unseen") {
        // The write bumps revision past this, so the latest update reads as new again.
        if (state.seenRevision < state.revision) return;
        state.seenRevision = state.revision;
        return "Marked unread";
      }
      if (input.action === "seen") {
        if (state.seenRevision === state.revision) return;
        state.seenRevision = state.revision + 1;
        return "Updates read";
      }
      state.status = input.status;
      return "Workflow " + input.status;
    });
    return { workflow };
  }
  const { run, cwd } = implementationForTask(input.taskId);
  const fingerprint = await worktreeFingerprint(cwd);
  let checkId: string | undefined;
  const workflow = await updateWorkflow(input.taskId, input.revision, (state) => {
    if (["paused", "complete", "abandoned"].includes(state.status) && input.action !== "receipt") throw new Error("Resume the workflow before continuing.");
    invalidateEvidence(state, fingerprint);
    if (input.action === "verify") {
      if (state.checks.some((check) => check.outcome === "running" && Date.parse(check.startedAt) > Date.now() - 660000)) throw new Error("Verification is already running.");
      for (const check of state.checks) if (check.outcome === "running") check.outcome = "interrupted";
      checkId = randomUUID();
      state.checks.push({ id: checkId, runId: run.spec.id, cwd, fingerprint, command: "npm run verify", startedAt: new Date().toISOString(), exitCode: null, outcome: "running" });
      state.stage = "verify";
      state.status = "active";
      return "Verification started";
    }
    if (input.action === "review") {
      const reviewRun = listTaskAgentRuns(input.taskId).find((item) => item.runId === input.runId && item.role === "review");
      if (!reviewRun || reviewRun.status !== "done") throw new Error("Choose a completed reviewer linked to this task.");
      if (reviewRun.codeFingerprint !== fingerprint) throw new Error("The code changed after this review started. Request another review.");
      const check = state.checks.at(-1);
      if (check?.outcome !== "passed" || check.stale || check.fingerprint !== fingerprint) throw new Error("Verify this code before recording a review.");
      state.reviews.push({ runId: input.runId, fingerprint, verdict: input.verdict, findings: input.findings, recordedAt: new Date().toISOString() });
      state.stage = input.verdict === "pass" ? "approve" : "implement";
      state.status = input.verdict === "pass" ? "waiting-user" : "blocked";
      return input.verdict === "pass" ? "Review accepted" : "Review requires changes";
    }
    if (input.action === "propose") {
      if (!evidenceReady(state, fingerprint)) throw new Error("Passing checks and an independent review of this code are required.");
      state.proposals.push({ id: randomUUID(), kind: input.kind, runId: run.spec.id, fingerprint, destination: input.destination, content: input.content, contentHash: contentHash(input.content), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), state: "pending" });
      state.stage = "approve";
      state.status = "waiting-user";
      return "Approval requested: " + input.kind;
    }
    const proposal = state.proposals.find((item) => item.id === input.proposalId);
    if (!proposal) throw new Error("Proposal not found.");
    if (input.action === "receipt") {
      if (proposal.state !== "outcome-unknown") throw new Error("Start the approved action before recording its outcome.");
      proposal.state = input.succeeded ? "succeeded" : "failed";
      if (input.succeeded && proposal.kind === "draft-pr") state.stage = "draft-pr";
      if (input.succeeded && proposal.kind === "task-completion") state.status = "complete";
      else state.status = input.succeeded ? "waiting-user" : "blocked";
      return (input.succeeded ? "Completed: " : "Failed: ") + proposal.kind + " — " + input.detail;
    }
    if (input.action === "begin") {
      if (proposal.runId !== run.spec.id || contentHash(proposal.content) !== proposal.contentHash) throw new Error("The implementation or proposal changed. Request a fresh approval.");
      if (proposal.state !== "approved") throw new Error("This approval has already been used or is not approved.");
      if (!evidenceReady(state, fingerprint) || proposal.fingerprint !== fingerprint || Date.parse(proposal.expiresAt) <= Date.now()) throw new Error("Approval expired or code changed. Request a fresh approval.");
      proposal.state = "outcome-unknown";
      return "Action started: " + proposal.kind + ". Check its destination before retrying after a timeout.";
    }
    if (proposal.state !== "pending") throw new Error("This proposal is no longer pending.");
    if (!evidenceReady(state, fingerprint) || proposal.fingerprint !== fingerprint || Date.parse(proposal.expiresAt) <= Date.now()) throw new Error("The proposal expired or its evidence changed. Create a new proposal.");
    if (contentHash(proposal.content) !== proposal.contentHash) throw new Error("Proposal content changed.");
    proposal.state = input.approve ? "approved" : "rejected";
    state.status = input.approve ? "active" : "blocked";
    return (input.approve ? "Approved: " : "Rejected: ") + proposal.kind;
  });
  return { workflow, checkId };
}

export async function executeWorkflowCheck(taskId: string, checkId: string): Promise<void> {
  let claimed = false;
  const claimedState = await updateWorkflow(taskId, undefined, (state) => {
    const check = state.checks.find((item) => item.id === checkId && item.outcome === "running");
    if (!check || check.executionStarted) return;
    check.executionStarted = true;
    claimed = true;
    return "Verification command started";
  });
  const savedCheck = claimedState.checks.find((check) => check.id === checkId);
  if (!claimed || !savedCheck) return;
  let cwd: string | undefined;
  let exitCode: number | null = 0;
  let detail: string | undefined;
  try {
    const checkCwd = savedCheck.cwd ?? readAgentRun(savedCheck.runId)?.spec.cwd;
    if (!checkCwd) throw new Error("Implementation run disappeared before checks started.");
    cwd = validateAgentCwd(checkCwd);
    await execExternal("npm", ["run", "verify"], { cwd, timeoutMs: 600000, maxBuffer: 8 * 1024 * 1024, label: "workflow:verify" });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    exitCode = typeof code === "number" ? code : null;
    // Build output may contain secrets. Keep it in the command's own logs.
    detail = exitCode === null ? "Verification was interrupted or could not start. Inspect the checkout and retry." : "Verification failed. Fix the failing checks in the checkout and retry.";
  }
  let fingerprint: string | undefined;
  let currentCwd: string | undefined;
  try {
    if (cwd) fingerprint = await worktreeFingerprint(cwd);
    currentCwd = implementationForTask(taskId).cwd;
  } catch { detail = "Could not inspect the worktree after verification."; }
  await updateWorkflow(taskId, undefined, (state) => {
    const check = state.checks.find((item) => item.id === checkId);
    if (!check || check.outcome !== "running") return;
    const unchanged = cwd !== undefined && cwd === currentCwd && check.fingerprint === fingerprint;
    check.finishedAt = new Date().toISOString();
    check.exitCode = exitCode;
    check.outcome = exitCode === 0 && unchanged ? "passed" : exitCode === null || !unchanged ? "interrupted" : "failed";
    check.detail = unchanged || fingerprint === undefined ? detail : "Code changed during verification. Run checks again.";
    if (!["paused", "abandoned", "complete"].includes(state.status)) {
      state.stage = check.outcome === "passed" ? "review" : "implement";
      state.status = check.outcome === "passed" ? "waiting-user" : "blocked";
    }
    return "Verification " + check.outcome;
  });
}
