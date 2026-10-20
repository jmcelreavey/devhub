"use client";

import { mutate } from "swr";
import { FileText } from "lucide-react";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { TASK_NOTE_STATUSES, type TaskNoteStatus } from "@shared/task-note/meta.ts";
import { CardMenu, type CardMenuActions } from "@/app/storyboard/CardMenu";
import { setCardStatus } from "@/app/storyboard/board-actions";
import type { ContextMenuPosition } from "@/components/shell/ContextMenu";
import { useToast } from "@/lib/hooks/use-toast";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { useTaskDetail } from "./TaskDetailProvider";
import { useWorkAction } from "./useWorkAction";
import { useTeamTaskActions } from "./TeamTaskActions";
import { ContextMenu } from "@/components/shell/ContextMenu";

export function WorkCardMenu({ card, open, position, onClose, config }: { config?: { actions: CardMenuActions; columns: readonly TaskNoteStatus[]; place: { index: number; count: number } }; card: BoardCard; open: boolean; position: ContextMenuPosition | null; onClose: () => void }) {
  const detail = useTaskDetail();
  const team = useTeamTaskActions(card, detail?.profileId);
  const perform = useWorkAction(detail?.profileId);
  const toast = useToast();
  const run: CardMenuActions["run"] = async (_card, work, success) => {
    const result = await work();
    if (!result.ok) toast.error(result.error ?? "Couldn't update the task.");
    else if (success) toast.success(success);
    void mutate((key) => typeof key === "string" && (key.startsWith("/api/storyboard") || key.startsWith("/api/sidebar/counts")));
  };
  const actions: CardMenuActions = {
    run,
    move: (item, status) => run(item, () => setCardStatus(item, status, detail?.profileId), "Task moved."),
    reorder: () => undefined,
    attention: (item, attention) => { if (["retry", "auto-retry", "clear"].includes(attention.action.kind)) void perform(item, { kind: attention.action.kind as "retry" | "auto-retry" | "clear", label: attention.action.label, attention }); },
    complete: (item) => { void perform(item, { kind: "done", label: "Done" }); },
    openNote: (item) => detail?.openTask(item.taskId, "note"),
  };
  const task = card.task ?? { id: card.taskId, text: card.title, done: card.taskDone, startDate: card.date, createdAt: card.updatedAt, rank: card.rank ?? "a0" };
  if (isTaskOwnershipBlocked(task)) return <ContextMenu open={open} position={position} onClose={onClose} groups={[{ id: "read-only", items: [{ id: "open", label: "Open note", icon: <FileText size={12} aria-hidden />, onSelect: () => detail?.openTask(card.taskId, "note") }] }]} label="Handed-off task" />;
  return <><CardMenu card={card} task={task} open={open} position={position} onClose={onClose} columns={config?.columns ?? TASK_NOTE_STATUSES} place={config?.place ?? { index: 0, count: 1 }} actions={config?.actions ?? actions} extraGroups={team.groups} />{team.dialogs}</>;
}
