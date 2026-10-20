import type { GithubPrRow } from "@/lib/github/prs";
import { finishedTaskFeedback, type PrFeedbackSnapshot } from "@/lib/github/finished-task-feedback";
import { actionablePrs, prIdentity } from "@/lib/github/actionable-prs";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import { compareCards, type BoardCard } from "./notes-board-shared";
import { hasLiveWork, type AttentionWork, type WorkPresentation } from "./next-action";
import { resolveWorkPresentation, workSummary } from "./work-summary";
import { formatRelativePastAge } from "@/lib/utils";

export type HomeSection = "needs-you" | "review-requested" | "blocked" | "running" | "next";
export interface TaskWork extends AttentionWork { kind: "task" }
export interface PeerReviewWork { kind: "pr"; pr: GithubPrRow; presentation: WorkPresentation }
export type HomeWork = TaskWork | PeerReviewWork;
export interface HomeSections { "review-requested": TaskWork[]; blocked: TaskWork[]; "needs-you": HomeWork[]; running: TaskWork[]; next: TaskWork[] }

export function peerReviewWork(pr: GithubPrRow): PeerReviewWork {
  return { kind: "pr", pr, presentation: { status: `Review requested${pr.author ? ` · @${pr.author.login}` : ""}`, needsYou: true, action: { kind: "review", label: "Review", href: pr.url, external: true } } };
}

export function homeWorkKey(work: HomeWork): string {
  return work.kind === "task" ? `task:${work.card.taskId}` : `pr:${prIdentity(work.pr)}`;
}

export function homeWorkSummary(cards: readonly BoardCard[], items: readonly WorkflowInboxItem[], reviews: readonly GithubPrRow[], now: number, authored: readonly GithubPrRow[] = [], ownedRepos: readonly string[] = [], feedbackPrs: readonly PrFeedbackSnapshot[] = []): HomeSections {
  const summary = workSummary(cards, items, now);
  const needsYou: HomeWork[] = summary.needsYou.map((work) => ({ kind: "task", ...work }));
  const included = new Set(summary.needsYou.map(({ card }) => card.taskId));
  for (const card of cards) {
    const feedback = finishedTaskFeedback(card, feedbackPrs);
    if (!feedback || included.has(card.taskId)) continue;
    included.add(card.taskId);
    needsYou.push({ kind: "task", card: { ...card, finishedFeedback: feedback, ...(feedback.action === "follow-up" ? { prState: "merged" } : {}) }, presentation: { status: `New feedback on a finished task · ${feedback.summary}`, needsYou: true, action: { kind: feedback.action, label: feedback.action === "follow-up" ? "Create follow-up task" : "Reopen and address feedback" } } });
  }
  const linkedPrs = new Set(summary.needsYou.flatMap(({ card }) => card.prUrl ? [card.prUrl.toLowerCase()] : []));
  const actionable = actionablePrs(authored, reviews, ownedRepos);
  needsYou.push(...actionable.reviews.filter((pr) => !linkedPrs.has(pr.url.toLowerCase())).map(peerReviewWork));
  needsYou.push(...actionable.mine.filter((pr) => !linkedPrs.has(pr.url.toLowerCase())).map((pr): PeerReviewWork => ({
    kind: "pr", pr, presentation: {
      status: pr.checks === "failing" ? "Your PR has failing checks" : pr.reviewDecision === "CHANGES_REQUESTED" ? "Changes requested on your PR" : "Your PR is ready to merge",
      needsYou: true,
      action: { kind: "review", label: "Open PR", href: pr.url, external: true },
    },
  })));
  const running: TaskWork[] = [];
  const next: TaskWork[] = [];
  const ranked = [...cards].sort((left, right) => compareCards({ ...left, rank: left.rank ?? left.task?.rank }, { ...right, rank: right.rank ?? right.task?.rank }));
  for (const card of ranked) {
    if (included.has(card.taskId) || card.taskDone || card.status === "done" || card.task?.abandonedAt) continue;
    included.add(card.taskId);
    const presentation = resolveWorkPresentation(card, summary.workflows.get(card.taskId), now);
    const workflowStatus = summary.workflows.get(card.taskId)?.status;
    const paused = card.auto?.status === "paused-manual" || card.auto?.status === "paused" || card.run?.status === "paused" || workflowStatus === "paused";
    if (hasLiveWork(card) && card.status !== "blocked" && workflowStatus !== "blocked" && !paused && presentation.action?.kind === "progress") {
      const updated = Date.parse(card.auto?.updatedAt ?? card.run?.updatedAt ?? card.updatedAt);
      const phase = card.auto?.label ?? (card.run?.status === "queued" ? "Queued" : card.run?.role ? `${card.run.role[0].toUpperCase()}${card.run.role.slice(1)}` : "Agent running");
      running.push({ kind: "task", card, presentation: { ...presentation, status: `${phase} · updated ${Number.isFinite(updated) ? formatRelativePastAge(now - updated) : "at an unknown time"}` } });
    } else if (!hasLiveWork(card) && (presentation.action?.kind === "start-auto" || presentation.action?.kind === "done" || (card.failure?.cleared && presentation.action?.kind === "progress"))) {
      next.push({ kind: "task", card, presentation });
    }
  }
  const blocked = needsYou.filter((work): work is TaskWork => work.kind === "task" && !!work.presentation.action && (["approve-plan", "answer", "choose-repo", "retry", "auto-retry", "clear"].includes(work.presentation.action.kind) || work.presentation.action.label === "Inspect failure"));
  // Your own tasks never become "Review requested": that is for other people's PRs. A finished review stays on the task's card in Ready for review.
  const requested: TaskWork[] = [];
  return { "needs-you": needsYou, "review-requested": requested, blocked, running, next };
}

/** Exactly the task rows Home marks as needing action, including AI reviews and finished-task feedback. PR peer reviews stay in the PRs section. */
export function homeNeedsAction(sections: HomeSections): TaskWork[] {
  return sections["needs-you"].filter((work): work is TaskWork => work.kind === "task");
}

function homeTaskPaused(card: TaskWork["card"]): boolean {
  return card.auto?.status === "paused-manual" || card.auto?.status === "paused" || card.run?.status === "paused";
}

function homeTaskUpdatedAt(card: TaskWork["card"]): string {
  return card.auto?.updatedAt ?? card.run?.updatedAt ?? card.updatedAt ?? "";
}

/** Home My tasks order: needs action, then running/in progress (newest first), then next/to do, then the rest. */
export function sortHomeTaskRows(
  rows: readonly TaskWork[],
  attentionIds: ReadonlySet<string>,
  runningIds: ReadonlySet<string>,
  nextIds: ReadonlySet<string>,
): TaskWork[] {
  const group = (work: TaskWork): 0 | 1 | 2 | 3 => {
    const { card } = work;
    if (attentionIds.has(card.taskId)) return 0;
    if (runningIds.has(card.taskId) || (card.status === "in-progress" && !homeTaskPaused(card) && !card.failure?.cleared)) return 1;
    if ((nextIds.has(card.taskId) || card.status === "todo") && !homeTaskPaused(card) && !card.failure?.cleared) return 2;
    return 3;
  };
  return rows
    .map((work, index) => ({ work, index, group: group(work) }))
    .sort((left, right) => left.group - right.group
      || (left.group === 1 ? homeTaskUpdatedAt(right.work.card).localeCompare(homeTaskUpdatedAt(left.work.card)) : 0)
      || left.index - right.index)
    .map(({ work }) => work);
}

export function homeSectionHref(section: HomeSection, profile?: string): string {
  const params = new URLSearchParams({ ...(["needs-you", "review-requested", "blocked"].includes(section) ? { attention: section } : { queue: section }), ...(profile ? { profile } : {}) });
  return `/storyboard?${params}`;
}
