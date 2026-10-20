import { activeFailure, reviewNotes } from "./work-insights";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import type { TaskWorkflow, WorkflowEvent } from "@/lib/workflows/types";
import { hasLiveWork, resolveNextAction, type AttentionWork, type WorkPresentation } from "./next-action";
import { taskAttentionSuppressed, type BoardCard } from "./notes-board-shared";

const READ_EVENTS = new Set(["Updates read", "Marked unread"]);
const ACTION_EVENTS = /^(Approval requested:|Failed:|Verification (failed|interrupted)|Review requires changes|Evidence changed or verification was interrupted|Workflow (blocked|waiting-user)|\S+ run: failed)/;
const URGENCY: Record<string, number> = { "choose-repo": 0, answer: 0, retry: 1, "auto-retry": 1, clear: 2, "review-proposal": 3, review: 4, "create-pr": 4, finish: 5 };

export interface WorkflowUpdate {
  item: WorkflowInboxItem;
  event: WorkflowEvent;
  unread: boolean;
}

export function workflowUpdates(items: readonly WorkflowInboxItem[]): WorkflowUpdate[] {
  return items.flatMap((item) => {
    const { workflow, task } = item;
    if (task.id !== workflow.taskId) return [];
    const markedUnread = workflow.events.at(-1)?.summary === "Marked unread" && workflow.seenRevision < workflow.revision;
    return workflow.events.flatMap((event, index) => {
      if (READ_EVENTS.has(event.summary) || ACTION_EVENTS.test(event.summary)) return [];
      const revision = workflow.revision - workflow.events.length + index + 1;
      return [{ item, event, unread: markedUnread || revision > workflow.seenRevision }];
    });
  }).sort((left, right) => Number(right.unread) - Number(left.unread) || right.event.at.localeCompare(left.event.at));
}

/** An independent review that approves (including with nits) and does not ask for changes. */
export function reviewApproves(notes: string): boolean {
  const verdict = /\bverdict\b[^\n]{0,200}/i.exec(notes)?.[0] ?? notes.slice(0, 600);
  return /\bapprove/i.test(verdict) && !/(changes? (?:are )?(?:required|requested)|request(?:s|ed)? changes|must[- ]fix [1-9]|do not (?:ship|merge))/i.test(verdict);
}

export function resolveWorkPresentation(card: BoardCard, workflow: TaskWorkflow | undefined, now: number): WorkPresentation {
  const evidence = workflow?.taskId === card.taskId ? workflow : undefined;
  const failure = !taskAttentionSuppressed(card) && !card.task?.abandonedAt ? activeFailure(card) : undefined;
  // Open questions win over a failure banner: answering is the way forward, and Retry would stop at them again.
  if (failure && !hasLiveWork(card) && card.counts.openQuestions === 0) {
    const attention = { reason: "failing" as const, label: failure.summary, action: { kind: card.auto ? "auto-retry" as const : "retry" as const, label: "Retry" as const, taskId: card.taskId } };
    return { status: failure.summary, needsYou: true, action: { kind: attention.action.kind, label: "Retry", attention } };
  }
  if (!card.taskDone && !card.task?.abandonedAt && card.failure?.cleared && card.counts.openQuestions > 0 && card.noteHref) return { status: `${card.counts.openQuestions} questions need answers`, needsYou: true, action: { kind: "answer", label: "Answer", href: `${card.noteHref}#task-note-questions` } };
  if (!card.taskDone && !card.task?.abandonedAt && card.failure?.cleared && !card.counts.openQuestions && !hasLiveWork(card)) return { status: "Failure cleared · paused", needsYou: false, action: { kind: "progress", label: "View details", href: `/storyboard?task=${encodeURIComponent(card.taskId)}` } };
  const base = resolveNextAction(card, evidence, now);
  if (card.taskDone || card.task?.abandonedAt || taskAttentionSuppressed(card) || hasLiveWork(card)) return base;
  if (base.action?.kind === "approve-plan") return base;
  const notes = reviewNotes(card, evidence);
  if (base.action && ["choose-repo", "answer", "retry", "auto-retry", "clear"].includes(base.action.kind) && !(notes && base.action.kind === "answer" && card.counts.openQuestions === 0)) return base;
  if (notes) {
    // Reviewed and approved with no PR yet: the next step is the PR. Once it exists the row only needs the check and the PR tag;
    // the review itself is embedded in the panel, so there is no Open review button to press.
    if (!card.prUrl && card.repo && card.task && reviewApproves(notes.notes)) return { status: notes.gist, needsYou: true, action: { kind: "create-pr", label: "Approve and create PR" } };
    if (card.prUrl && reviewApproves(notes.notes)) return { status: notes.gist, needsYou: true, action: null };
    return { status: notes.gist, needsYou: true, action: { kind: "review", label: "Open review", href: `/storyboard?task=${encodeURIComponent(card.taskId)}&taskSection=evidence` } };
  }
  const review = evidence?.reviews.at(-1);
  const check = evidence?.checks.at(-1);
  const lastProposal = evidence?.proposals.at(-1);
  const failedProposal = lastProposal?.state === "failed" ? lastProposal : undefined;
  const failedRun = evidence?.status === "blocked" && Object.values(evidence.runStates ?? {}).some((run) => run.state === "failed");
  const workflowFailure = check && !check.stale && ["failed", "interrupted"].includes(check.outcome) ? `Verification ${check.outcome}${check.detail ? ` — ${check.detail}` : ""}`
    : review && !review.stale && review.verdict === "changes-requested" ? "Review requires changes"
    : failedProposal ? `Publication failed: ${failedProposal.kind}`
    : failedRun ? "Workflow run failed" : null;
  if (workflowFailure) return { status: workflowFailure, needsYou: true, action: { kind: "review", label: "Inspect failure", href: `/workflow?taskId=${encodeURIComponent(card.taskId)}` } };
  if (base.needsYou) return base;
  if (evidence?.status === "waiting-user" && ["verify", "review", "approve", "draft-pr"].includes(evidence.stage)) {
    return { status: evidence.stage === "verify" ? "Verification needs your review" : "Workflow ready for review", needsYou: true, action: { kind: "review", label: evidence.stage === "verify" ? "Review checks" : "Review", href: `/workflow?taskId=${encodeURIComponent(card.taskId)}` } };
  }
  return base;
}

export function workSummary(cards: readonly BoardCard[], items: readonly WorkflowInboxItem[], now: number) {
  const cardIds = new Set(cards.map((card) => card.taskId));
  const workflows = new Map(items.filter((item) => item.task.id === item.workflow.taskId && cardIds.has(item.task.id)).map((item) => [item.task.id, item.workflow]));
  const unique = new Map<string, AttentionWork>();
  for (const card of cards) {
    const presentation = resolveWorkPresentation(card, workflows.get(card.taskId), now);
    if (presentation.needsYou && !unique.has(card.taskId)) unique.set(card.taskId, { card, presentation });
  }
  const needsYou = [...unique.values()].sort((left, right) => (URGENCY[left.presentation.action?.kind ?? ""] ?? 6) - (URGENCY[right.presentation.action?.kind ?? ""] ?? 6));
  const updates = workflowUpdates(items);
  return { workflows, needsYou, updates, unreadUpdates: updates.filter((update) => update.unread).length };
}
