"use client";

import Link from "next/link";
import { WorkCard } from "@/components/storyboard/WorkCard";
import { useWorkAction } from "@/components/storyboard/useWorkAction";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import { needsYouWork, type NextAction, type WorkPresentation } from "@/lib/storyboard/next-action";
import type { BoardCard, NotesBoard } from "@/lib/storyboard/notes-board-shared";
import { useTaskActionPending } from "@/lib/storyboard/task-action";
import { WORKFLOW_INBOX_KEY, type WorkflowInboxResponse } from "@/lib/workflows/inbox";

function AttentionCard({ card, presentation, onOpen, detailHref, onRefresh }: {
  card: BoardCard;
  presentation: WorkPresentation;
  onOpen?: () => void;
  detailHref?: string;
  onRefresh: () => void;
}) {
  const pending = useTaskActionPending(card.taskId);
  const perform = useWorkAction();
  const act = async (action: NextAction) => {
    if (action.kind !== "finish" && action.kind !== "done") onOpen?.();
    await perform(card, action);
    onRefresh();
  };
  return <WorkCard card={card} presentation={presentation} pending={pending} onAction={(action) => void act(action)} onOpen={onOpen} detailHref={detailHref} />;
}

export function TodayNeedsYou({ limit = 3 }: { limit?: number }) {
  const board = useLive<NotesBoard>("/api/storyboard", { refreshInterval: 15_000 });
  const inbox = useLive<WorkflowInboxResponse>(WORKFLOW_INBOX_KEY, { refreshInterval: 15_000 });
  const detail = useTaskDetail();
  const work = needsYouWork(board.data?.cards ?? [], (inbox.data?.items ?? []).map((item) => item.workflow), board.data ? Date.parse(board.data.generatedAt) : 0);
  const loading = (!board.data && !board.error) || (!inbox.data && !inbox.error);
  const unavailable = !board.data && board.error;
  const degraded = board.error || inbox.error || (board.data?.errors.length ?? 0) > 0;
  const refresh = () => { void board.mutate(); void inbox.mutate(); };
  return (
    <section aria-label="Needs you" className="mb-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">Needs you{!loading && !unavailable && work.length > 0 ? <span className="ml-2 text-text-muted font-normal">{work.length}</span> : null}</h2>
        {!loading && work.length > 0 ? <Link className="text-xs text-text-muted hover:text-text" href="/storyboard?attention=needs-you">View all →</Link> : null}
      </div>
      {loading ? <div className="mt-3" aria-busy="true" aria-label="Loading tasks needing you"><SkeletonRows count={2} height={72} /></div>
        : unavailable ? <FetchError bare message="Couldn't load tasks needing you." onRetry={refresh} />
        : <>
          {work.slice(0, limit).map(({ card, presentation }) => <AttentionCard key={card.taskId} card={card} presentation={presentation} onRefresh={refresh} onOpen={detail ? () => detail.openTask(card.taskId) : undefined} detailHref={detail?.hrefForTask(card.taskId)} />)}
          {degraded ? <FetchError bare message="Some attention sources couldn't refresh. This list may be incomplete." onRetry={refresh} />
            : work.length === 0 ? <p className="mt-2 text-xs text-text-muted">Nothing waiting for you</p> : null}
        </>}
    </section>
  );
}
