import { isTaskOwnershipBlocked } from "@shared/tasks/types";
import type { AgentRun } from "@/lib/agent-runs/store";
import type { AutoPrReviewRecord } from "@/lib/github/auto-pr-review-state";
import type { GithubPrRow } from "@/lib/github/prs";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { TaskWorkflow } from "@/lib/workflows/types";
import type { AlertEvent } from "./alert-store";
import { slackMilestonesFromCards } from "./slack/milestones";
import { announcementTitle, freshPrAlert, PrAnnouncementSchema, reviewVerdict, type PrAnnouncement } from "./pr-announcement";

function announcement(pr: Pick<GithubPrRow, "url" | "title">): PrAnnouncement | undefined {
  const parsed = PrAnnouncementSchema.safeParse({ url: pr.url, title: announcementTitle(pr.title) });
  return parsed.success ? parsed.data : undefined;
}

function eligibleCard(card: BoardCard): boolean {
  return !card.taskDone && card.status !== "done" && card.status !== "draft-pr"
    && !card.task?.done && !card.task?.abandonedAt && card.task?.stage !== "draft" && !isTaskOwnershipBlocked(card.task)
    && card.prState !== "merged" && card.prState !== "closed";
}

function reviewedEvent(pr: PrAnnouncement, runId: string, at: string, taskId: string, now: number): AlertEvent[] {
  if (!freshPrAlert(at, now)) return [];
  return [{ id: `pr-reviewed:${pr.url.toLowerCase()}:${runId}`, at, taskId, kind: "pr-reviewed", announcement: pr }];
}

interface PrAlertSources {
  profile: string;
  cards: readonly BoardCard[];
  workflows: readonly TaskWorkflow[];
  prs: readonly GithubPrRow[];
  autoReviews: readonly AutoPrReviewRecord[];
  readRun: (id: string) => AgentRun | null;
  now: number;
}

/** Read-only adapters: delivery failures never participate in review or agent completion. */
export function prAlertEvents({ profile, cards, workflows, prs, autoReviews, readRun, now }: PrAlertSources): AlertEvent[] {
  const out: AlertEvent[] = [];
  const byUrl = new Map(prs.map((pr) => [pr.url.toLowerCase(), pr]));
  const eligible = cards.filter(eligibleCard);
  const byTask = new Map(eligible.map((card) => [card.taskId, card]));
  for (const milestone of slackMilestonesFromCards(profile, eligible, now)) {
    if (!["pr-opened", "ready-for-review"].includes(milestone.kind) || !milestone.url) continue;
    const card = byTask.get(milestone.taskId)!;
    const row = byUrl.get(milestone.url.toLowerCase());
    // Wait for known PR metadata: don't announce a draft or substitute a private task title.
    if (!row || row.draft !== false || row.prState === "closed" || row.prState === "merged") continue;
    const pr = announcement(row);
    if (!pr) continue;
    const ready = milestone.kind === "ready-for-review";
    const at = ready ? card.statusSetAt ?? card.run?.updatedAt ?? card.updatedAt : row.createdAt ?? card.run?.updatedAt ?? card.updatedAt;
    if (!freshPrAlert(at, now)) continue;
    const jira = card.jira?.find((key) => PrAnnouncementSchema.shape.jira.safeParse(key).success);
    out.push({
      // Opened → ready, retries and multiple task references still describe the same PR.
      id: `pr-ready:${pr.url.toLowerCase()}`, at, taskId: card.taskId, kind: "pr-ready",
      announcement: { ...pr, stage: ready ? "ready" : "opened", ...(jira ? { jira } : {}) },
    });
  }
  for (const workflow of workflows) {
    const card = byTask.get(workflow.taskId);
    if (!card?.prUrl) continue;
    const row = byUrl.get(card.prUrl.toLowerCase());
    if (!row || row.draft !== false || row.prState === "closed" || row.prState === "merged") continue;
    const pr = announcement(row);
    if (!pr) continue;
    for (const review of workflow.reviews.filter((review) => !review.stale)) {
      out.push(...reviewedEvent({ ...pr, verdict: review.verdict }, review.runId, review.recordedAt, card.taskId, now));
    }
    // Run completion can precede (or replace) a structured workflow review.
    for (const step of card.steps.filter((step) => step.role === "review" && step.status === "done")) {
      const run = readRun(step.runId);
      if (!run || !["completed", "succeeded"].includes(run.status.state)) continue;
      const at = new Date(run.status.finishedAt ?? run.status.updatedAt).toISOString();
      out.push(...reviewedEvent({ ...pr, ...reviewVerdict(run.status.resultText) }, step.runId, at, card.taskId, now));
    }
  }
  for (const record of autoReviews) {
    if (record.workProfile !== profile || !record.runId) continue;
    const row = byUrl.get(record.url.toLowerCase());
    if (row?.draft || row?.prState === "closed" || row?.prState === "merged") continue;
    const pr = announcement(record);
    if (!pr) continue;
    const run = readRun(record.runId);
    if (!run || !["completed", "succeeded"].includes(run.status.state)) continue;
    const taskId = run.spec.activity?.taskId;
    if (taskId && !byTask.has(taskId)) continue;
    const at = new Date(run.status.finishedAt ?? run.status.updatedAt).toISOString();
    out.push(...reviewedEvent({ ...pr, ...reviewVerdict(run.status.resultText) }, record.runId, at, taskId ?? "", now));
  }
  const unique = new Map<string, AlertEvent>();
  for (const event of out) if (!unique.has(event.id)) unique.set(event.id, event);
  return [...unique.values()];
}
