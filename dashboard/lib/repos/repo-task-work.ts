import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { compareCards } from "@/lib/storyboard/notes-board-shared";
import { homeNeedsAction, homeWorkSummary, sortHomeTaskRows, type TaskWork } from "@/lib/storyboard/home-summary";
import { hasLiveWork } from "@/lib/storyboard/next-action";
import { resolveWorkPresentation } from "@/lib/storyboard/work-summary";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import { repoLinkMatches } from "./repo-link-match";
import { taskBelongsToRepo } from "./work-hub";

export function repoTaskWork(cards: readonly BoardCard[], items: readonly WorkflowInboxItem[], repoName: string, fullName: string | null, now: number) {
  const linked = [...new Map(cards.filter((card) => taskBelongsToRepo(card.task ?? {}, repoName, fullName)
    || !!card.repo && repoLinkMatches(card.repo, repoName, fullName)).map((card) => [card.taskId, card])).values()];
  const summary = homeWorkSummary(linked, items, [], now);
  const attention = homeNeedsAction(summary);
  const projected = new Map([...attention, ...summary.running, ...summary.next].map((work) => [work.card.taskId, work]));
  const workflows = new Map(items.filter((item) => item.task.id === item.workflow.taskId).map((item) => [item.task.id, item.workflow]));
  const rows = [...new Map([...attention, ...[...linked].sort(compareCards).map((card): TaskWork => projected.get(card.taskId)
    ?? { kind: "task", card, presentation: resolveWorkPresentation(card, workflows.get(card.taskId), now) })].map((work) => [work.card.taskId, work])).values()];
  const ordered = sortHomeTaskRows(rows, new Set(attention.map(({ card }) => card.taskId)), new Set(summary.running.map(({ card }) => card.taskId)), new Set(summary.next.map(({ card }) => card.taskId)));
  const active: TaskWork[] = [];
  const backlog: TaskWork[] = [];
  const done: TaskWork[] = [];
  for (const work of ordered) {
    const { card, presentation } = work;
    if (card.finishedFeedback) active.push(work);
    else if (card.taskDone || card.task?.done || card.task?.abandonedAt || card.task?.endDate) done.push(work);
    else if (card.status === "todo" && !presentation.needsYou && !hasLiveWork(card) && !card.auto && !card.failure) backlog.push(work);
    else active.push(work);
  }
  return { active, backlog, done };
}
