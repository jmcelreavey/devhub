import { cardAttention, type CardAttention } from "./attention";
import { taskAttentionSuppressed, type BoardCard } from "./notes-board-shared";
import { autoProgress } from "./auto-phase";
import { storyboardHrefForTask } from "./orchestration";
import { agentChatHrefForRun } from "@/lib/tasks/task-agent-resume";
import type { TaskWorkflow } from "@/lib/workflows/types";
import { formatRelativePastAge } from "@/lib/utils";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";

export type NextAction =
  | { kind: "reopen" | "reopen-feedback" | "follow-up"; label: string }
  | { kind: "start-auto"; label: "Start on auto"; pauseAfterPlan?: boolean }
  | { kind: "approve-plan"; label: "Approve plan" }
  /** Reviewed work with no PR yet: approve it and open the draft PR. */
  | { kind: "create-pr"; label: "Approve and create PR" }
  | { kind: "finish" | "done"; label: "Finish" | "Done" }
  | { kind: "retry" | "auto-retry" | "clear"; label: string; attention: CardAttention }
  | { kind: "choose-repo" | "answer" | "progress" | "review-proposal" | "review"; label: string; href: string; external?: boolean };

export interface WorkPresentation {
  status: string;
  action: NextAction | null;
  needsYou: boolean;
}

type LiveWork = Partial<Pick<BoardCard, "run" | "steps" | "auto">>;

export function hasLiveWork(card: LiveWork): boolean {
  const active = (status: string | undefined) => status === "queued" || status === "running" || status === "starting";
  return active(card.run?.status) || active(card.auto?.status) || !!card.steps?.some((step) => active(step.status));
}

/**
 * Live work that should hold back Plan ready. A second plan run of the same
 * attempt (a duplicate dispatch) is not: auto mode already settled on its
 * plan run, and Approve checks that exact run under the lock.
 */
function liveWorkBesidesDuplicatePlans(card: BoardCard): boolean {
  const planRunId = card.auto?.planRunId;
  if (!planRunId) return hasLiveWork(card);
  const duplicate = (runId: string | undefined, role: string | undefined) => role === "plan" && !!runId && runId !== planRunId;
  return hasLiveWork({
    auto: card.auto,
    run: card.run && duplicate(card.run.runId, card.run.role) ? null : card.run,
    steps: card.steps?.filter((step) => !duplicate(step.runId, step.role)),
  });
}

export function workStatus(card: BoardCard, now: number): string {
  if (card.auto) return `${autoProgress(card.auto)}${card.auto.noPreview && card.auto.phase !== "ready" ? " · no preview" : ""}`;
  if (!card.noteHref && !card.run) return "No note yet";
  const agent = card.run ? `Agent ${card.run.status === "done" ? "finished" : card.run.status} · ` : "";
  const updated = Date.parse(card.updatedAt);
  return `${agent}Updated ${Number.isFinite(updated) ? formatRelativePastAge(now - updated) : "at an unknown time"}`;
}

function reviewStatus(card: BoardCard, workflow?: TaskWorkflow): string {
  const checks = workflow?.checks ?? [];
  const checked = checks.length > 0 && checks.every((check) => check.outcome === "passed" && !check.stale);
  const qa = card.auto?.noPreview ? "QA skipped — no preview"
    : card.auto?.qaSkipped ? `QA skipped — ${card.auto.qaSkipped}`
    : card.jev ? `QA ${card.jev.status}` : "QA not recorded";
  return `${checked ? "Checks passed" : "Ready for review"} · ${qa}`;
}

export function resolveNextAction(card: BoardCard, workflow: TaskWorkflow | undefined, now: number): WorkPresentation {
  const result = (status: string, action: NextAction | null, needsYou = false): WorkPresentation => ({ status, action, needsYou });
  if (card.task?.handoff) return result((card.task.handoff.status === "pending" ? "Handing to @" : "Handed to @") + card.task.handoff.toName + (card.task.handoff.status === "pending" ? "…" : ""), null);
  if (isTaskOwnershipBlocked(card.task)) return result(card.task?.abandonedAt ? "Handoff was declined/expired" : "Confirming pickup…", null);
  if (card.taskDone && card.finishedFeedback) return result(`New feedback on a finished task · ${card.finishedFeedback.summary}`, { kind: card.finishedFeedback.action, label: card.finishedFeedback.action === "follow-up" ? "Create follow-up task" : "Reopen and address feedback" }, true);
  if (card.taskDone || card.task?.abandonedAt) return result(card.taskDone ? "Done" : "Abandoned", null);
  if (taskAttentionSuppressed(card)) {
    if (hasLiveWork(card)) return result("Work is still running. Wait for it to finish or stop it before finishing this task.", { kind: "progress", label: "View progress", href: card.run ? agentChatHrefForRun(card.run.runId) : storyboardHrefForTask(card.taskId) });
    return card.status === "done"
      ? result("Work finished · task still open", { kind: "finish", label: "Finish" }, true)
      : result("To do", { kind: "start-auto", label: "Start on auto" });
  }
  if (card.auto?.status === "needs-you" && card.auto.waiting?.kind === "plan-approval" && !liveWorkBesidesDuplicatePlans(card) && !card.counts.openQuestions) return result("Plan ready", { kind: "approve-plan", label: "Approve plan" }, true);
  const attention = card.attention ?? cardAttention({
    ...card,
    autoWaiting: card.auto?.status === "needs-you" ? card.auto.waiting : undefined,
  }, now);
  if (attention?.action.kind === "open") {
    // Only an open repo question is "Choose repo"; any other orchestrator wait shows its own reason.
    const repo = !!card.waitingOnRepo && !card.counts.openQuestions && attention.action.href === storyboardHrefForTask(card.taskId);
    const question = card.counts.openQuestions > 1 ? `${card.counts.openQuestions} questions need answers` : (card.counts.openQuestions > 0 || card.auto?.waiting?.kind !== "questions" ? card.auto?.waiting?.reason : undefined) ?? (card.counts.openQuestions === 1 ? "1 question needs an answer" : attention.label);
    return result(repo ? "Choose the repo for this task" : question, { kind: repo ? "choose-repo" : "answer", label: repo ? "Choose repo" : "Answer", href: attention.action.href }, true);
  }
  if (attention?.action.kind === "clear") return result(attention.label, { kind: "clear", label: attention.action.label, attention }, true);
  if (hasLiveWork(card)) {
    const status = card.prState === "merged" || card.status === "done"
      ? "Work is still running. Wait for it to finish or stop it before finishing this task."
      : workStatus(card, now);
    return result(status, { kind: "progress", label: "View progress", href: card.run ? agentChatHrefForRun(card.run.runId) : storyboardHrefForTask(card.taskId) });
  }
  if (attention && (attention.action.kind === "retry" || attention.action.kind === "auto-retry")) {
    return result(attention.label, { kind: attention.action.kind, label: attention.action.label, attention }, true);
  }
  const proposal = workflow?.proposals.find((item) => item.state === "pending" || item.state === "outcome-unknown");
  if (proposal) {
    const status = proposal.state === "outcome-unknown" ? "Check the publication outcome before retrying"
      : proposal.kind === "draft-pr" ? "Draft PR approval needed" : "Proposal approval needed";
    return result(status, { kind: "review-proposal", label: "Review proposal", href: `/workflow?taskId=${encodeURIComponent(card.taskId)}` }, true);
  }
  if (card.prState === "merged" || workflow?.status === "complete") {
    return result(card.prState === "merged" ? "PR merged · task still open" : "Work finished · task still open", { kind: "finish", label: "Finish" }, true);
  }
  if (card.status === "ready-for-review" && card.prState !== "closed") {
    return result(reviewStatus(card, workflow), { kind: "review", label: "Review", href: card.prUrl ?? `/workflow?taskId=${encodeURIComponent(card.taskId)}`, ...(card.prUrl ? { external: true } : {}) }, true);
  }
  if (card.auto?.status === "paused-manual") return result(workStatus(card, now), { kind: "done", label: "Done" });
  if (card.status === "todo" && !card.auto && !attention) return result("To do", { kind: "start-auto", label: "Start on auto" });
  return result(workStatus(card, now), null);
}

export interface AttentionWork {
  card: BoardCard;
  presentation: WorkPresentation;
}

export function needsYouWork(cards: readonly BoardCard[], workflows: readonly TaskWorkflow[], now: number): AttentionWork[] {
  const byTask = new Map(workflows.map((workflow) => [workflow.taskId, workflow]));
  const unique = new Map<string, AttentionWork>();
  for (const card of cards) {
    if (unique.has(card.taskId)) continue;
    const presentation = resolveNextAction(card, byTask.get(card.taskId), now);
    if (presentation.needsYou) unique.set(card.taskId, { card, presentation });
  }
  const urgency: Record<string, number> = { "choose-repo": 0, answer: 0, retry: 1, "auto-retry": 1, clear: 2, "review-proposal": 3, review: 4, "create-pr": 4, finish: 5 };
  return [...unique.values()].sort((left, right) => (urgency[left.presentation.action?.kind ?? ""] ?? 6) - (urgency[right.presentation.action?.kind ?? ""] ?? 6));
}
