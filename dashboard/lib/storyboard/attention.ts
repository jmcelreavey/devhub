import { taskAttentionSuppressed, type BoardCard } from "./notes-board-shared";
import { storyboardHrefForTask } from "./orchestration";

/** A run still "running" this long after it started is treated as an idle agent. */
export const IDLE_AFTER_MS = 2 * 60 * 60 * 1000;

export type AttentionAction =
  | { kind: "open-pr"; label: "Open PR"; url: string }
  | { kind: "retry"; label: "Retry"; taskId: string }
  /** Auto mode at Needs you after a failure or the fix-round cap: carry on (a retry escalates the tier). */
  | { kind: "auto-retry"; label: "Retry" | "One more round"; taskId: string }
  | { kind: "clear"; label: "Clear"; taskId: string; runId: string }
  | { kind: "open"; label: "Answer"; href: string };

export interface CardAttention {
  reason: "awaiting" | "failing" | "idle";
  label: string;
  action: AttentionAction;
}

type AttentionInput = Pick<BoardCard, "taskId" | "status" | "statusSetAt" | "taskDone" | "noteHref" | "prUrl" | "prState" | "run" | "counts"> & {
  /** The task's orchestration is blocked on John: a repo to pick, or a QA failure to read. Its question is not in the note. */
  orchestratorWaiting?: boolean;
  /** Why auto mode stopped at Needs you. */
  autoWaiting?: { kind: "questions" | "failure" | "cap" | "queued" | "plan-approval"; reason: string };
};

/** Retry resumes the implementation agent, so only a failed implementation run is something Retry can redo. */
function isImplementationRun(role: string | undefined): boolean {
  return !role || role === "implement";
}

/** Where John answers: the note's questions; the Storyboard for the orchestrator's (that question is not in the note). */
function answerHref(card: AttentionInput): string | undefined {
  const questionsHref = card.noteHref ? `${card.noteHref}#task-note-questions` : undefined;
  if (card.counts.openQuestions > 0 && questionsHref) return questionsHref;
  if (card.orchestratorWaiting) return storyboardHrefForTask(card.taskId);
  return undefined; // needs-you with nothing to answer is not an Answer: it would open an empty list.
}

/** A merged or closed PR is not waiting on anyone. */
function prAwaitingReview(card: AttentionInput): string | undefined {
  return card.status === "ready-for-review" && card.prState !== "merged" && card.prState !== "closed" ? card.prUrl : undefined;
}

/**
 * Why a card needs John right now, and the single action that unblocks it.
 * Null when nothing is stuck. Order matters: a question to answer beats a
 * failure, which beats an idle agent, which beats a PR waiting on review.
 */
export function cardAttention(card: AttentionInput, now = Date.now()): CardAttention | null {
  if (card.taskDone || taskAttentionSuppressed(card)) return null;

  // Open questions come before any failure: they are usually why the run stopped, and Retry would only hit the same wall.
  const questionsHref = card.counts.openQuestions > 0 ? answerHref(card) : undefined;
  if (questionsHref) return { reason: "awaiting", label: "Waiting on you", action: { kind: "open", label: "Answer", href: questionsHref } };

  // Auto mode's own stops come first: its Retry is the one click that carries on.
  if (card.autoWaiting?.kind === "failure") return { reason: "failing", label: card.autoWaiting.reason, action: { kind: "auto-retry", label: "Retry", taskId: card.taskId } };
  if (card.autoWaiting?.kind === "cap") return { reason: "failing", label: card.autoWaiting.reason, action: { kind: "auto-retry", label: "One more round", taskId: card.taskId } };

  const href = answerHref(card);
  if (href) return { reason: "awaiting", label: "Waiting on you", action: { kind: "open", label: "Answer", href } };

  if (card.run?.status === "failed" && isImplementationRun(card.run.role)) return { reason: "failing", label: "Run failed", action: { kind: "retry", label: "Retry", taskId: card.taskId } };
  if (card.counts.blockerBugs > 0) return { reason: "failing", label: "Blocker bug open", action: { kind: "retry", label: "Retry", taskId: card.taskId } };

  if (card.run?.status === "running") {
    const started = Date.parse(card.run.startedAt);
    if (Number.isFinite(started) && now - started > IDLE_AFTER_MS) {
      return { reason: "idle", label: "Agent idle", action: { kind: "clear", label: "Clear", taskId: card.taskId, runId: card.run.runId } };
    }
  }

  const prUrl = prAwaitingReview(card);
  if (prUrl) return { reason: "awaiting", label: "PR awaiting review", action: { kind: "open-pr", label: "Open PR", url: prUrl } };
  return null;
}
