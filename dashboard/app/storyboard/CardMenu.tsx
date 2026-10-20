"use client";

import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { resetTaskConfirmation } from "@/components/storyboard/reset-confirmation";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { recoverCardFailure, reopenCard } from "./board-actions";
import { REOPEN_TOAST, reopenMenuGroup } from "@/components/storyboard/reopenMenuItems";
import { ArrowDown, ArrowRight, ArrowUp, FileText, MessageSquare, RotateCcw, Undo2, X } from "lucide-react";
import { TASK_NOTE_STATUS_LABEL, type TaskNoteStatus } from "@shared/task-note/meta.ts";
import { ContextMenu, type ContextMenuGroup, type ContextMenuPosition } from "@/components/shell/ContextMenu";
import { useTaskMenu } from "@/components/tasks/useTaskMenu";
import { requestTaskNote } from "@/components/tasks/AddNoteComposer";
import type { CardAttention } from "@/lib/storyboard/attention";
import { moveCheck, type BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { Task } from "@/lib/tasks/types";
import { buildTaskReviewMessage, copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";
import { abandonTask, resetTask, setTaskText, toggleTaskTimer, type ActionResult } from "./board-actions";

export interface CardMenuActions {
  move: (card: BoardCard, status: TaskNoteStatus) => void;
  /** -1 up, 1 down. */
  reorder: (card: BoardCard, direction: -1 | 1) => void;
  attention: (card: BoardCard, attention: CardAttention) => void;
  complete: (card: BoardCard) => void;
  openNote: (card: BoardCard, notePath: string) => void;
  /** Runs a task write with the board's busy state and refresh. */
  run: (card: BoardCard, work: () => Promise<ActionResult>, success: string) => void;
}

/** Board-only actions, after the shared task items: where the card sits and how to unstick it. */
export function boardMenuGroups(card: BoardCard, { columns, place, actions, confirm, profile }: { confirm: ReturnType<typeof useConfirm>; profile?: string; columns: readonly TaskNoteStatus[]; place: { index: number; count: number }; actions: CardMenuActions }): ContextMenuGroup[] {
  const { attention } = card;
  const retry = !card.failure && attention && attention.action.kind !== "open" && attention.action.kind !== "open-pr" ? attention : null;
  const groups: ContextMenuGroup[] = [];
  if (retry) {
    groups.push({ id: "board-retry", items: [{ id: "retry", label: retry.action.label, description: retry.label, icon: <RotateCcw size={12} aria-hidden />, onSelect: () => actions.attention(card, retry) }] });
  }
  groups.push({
    id: "board-order",
    label: "Position",
    items: [
      { id: "move-up", label: "Move up", icon: <ArrowUp size={12} aria-hidden />, disabled: place.index <= 0, onSelect: () => actions.reorder(card, -1) },
      { id: "move-down", label: "Move down", icon: <ArrowDown size={12} aria-hidden />, disabled: place.index >= place.count - 1, onSelect: () => actions.reorder(card, 1) },
    ],
  });
  // Anything past To do has work to undo: runs, auto mode, checkouts. A plain To do card has nothing.
  if (card.status !== "todo" && !card.taskDone && !card.task?.abandonedAt && !isTaskOwnershipBlocked(card.task)) {
    const reset = async (discard: boolean) => {
      if (await confirm(resetTaskConfirmation(discard))) actions.run(card, () => resetTask(card.taskId, discard, profile), discard ? "Work discarded. Task is back on To do." : "Task is back on To do.");
    };
    groups.push({ id: "board-reset", items: [
      { id: "reset-todo", label: "Reset to To do…", description: "Stop runs and clear auto mode, keep the work", icon: <Undo2 size={12} aria-hidden />, onSelect: () => reset(false) },
      { id: "reset-discard", label: "Discard work and reset…", danger: true, description: "Also delete the agent checkouts and local branches", icon: <Undo2 size={12} aria-hidden />, onSelect: () => reset(true) },
    ] });
  }
  groups.push({
    id: "board-move",
    label: "Move",
    items: [{
      id: "move-to",
      label: "Move to…",
      icon: <ArrowRight size={12} aria-hidden />,
      onSelect: () => undefined,
      submenu: columns
      .filter((status) => status !== card.status)
      .map((status) => {
        const check = moveCheck(card, status);
        return {
          id: `move-${status}`,
          label: TASK_NOTE_STATUS_LABEL[status],
          icon: <ArrowRight size={12} aria-hidden />,
          disabled: !check.ok,
          ...(check.ok ? {} : { disabledReason: card.taskDone ? "Task is done" : "Not from here" }),
          onSelect: () => actions.move(card, status),
        };
      }),
    }],
  });
  return groups;
}

/**
 * The card's right-click menu: the Today's-tasks menu (useTaskMenu) plus the board's own groups.
 * Mounted for one card at a time, and kept mounted after the menu closes so a dialog it opened stays up.
 */
export function CardMenu({
  card,
  task,
  open,
  position,
  onClose,
  columns,
  place,
  actions,
  busy = false,
  extraGroups = [],
}: {
  card: BoardCard;
  task: Task;
  open: boolean;
  position: ContextMenuPosition | null;
  onClose: () => void;
  columns: readonly TaskNoteStatus[];
  place: { index: number; count: number };
  actions: CardMenuActions;
  busy?: boolean;
  extraGroups?: ContextMenuGroup[];
}) {
  const detail = useTaskDetail();
  const confirm = useConfirm();
  const toast = useToast();
  const taskMenu = useTaskMenu({
    task,
    date: card.date,
    repoName: card.repo,
    inactive: !!task.abandonedAt,
    menuOpen: open,
    handlers: {
      onAddNote: () => requestTaskNote(card.taskId),
      onToggle: () => actions.complete(card),
      onComplete: () => actions.complete(card),
      onAbandon: (reason) => actions.run(card, () => abandonTask(task.id, reason), "Task abandoned."),
      // Closed cards get the shared Reopen group below instead of a separate Reactivate.
      onEdit: (text) => actions.run(card, () => setTaskText(task.id, text), ""),
      onTimer: () => actions.run(card, () => toggleTaskTimer(task.id, !!task.timerStartedAt), task.timerStartedAt ? "Timer stopped." : "Timer started."),
      onOpenNote: (notePath) => actions.openNote(card, notePath),
    },
    extraGroups: [
      ...extraGroups,
      ...(card.status === "ready-for-review" ? [{ id: "slack-review", items: [{ id: "copy-slack", label: "Copy Slack message", description: "Ask for a review, with the PR and Jira links", icon: <MessageSquare size={12} aria-hidden />, onSelect: () => void copyTextAndToast(buildTaskReviewMessage(card), "Slack message", toast) }] }] : []),
      ...(() => { const group = reopenMenuGroup(card, (kind) => actions.run(card, () => reopenCard(card, kind, detail?.profileId), REOPEN_TOAST[kind])); return group ? [group] : []; })(),
      ...(card.failure ? [{ id: "failure", label: "Recovery", items: [
        { id: "failure-retry", label: "Retry", icon: <RotateCcw size={12} aria-hidden />, onSelect: () => actions.run(card, () => recoverCardFailure(card, "retry", detail?.profileId), "Retrying failed step.") },
        { id: "failure-guidance", label: "Resume with guidance", icon: <MessageSquare size={12} aria-hidden />, onSelect: () => detail?.openTask(card.taskId, "guidance") },
        { id: "failure-logs", label: "Open logs", icon: <FileText size={12} aria-hidden />, onSelect: () => detail?.openTask(card.taskId, "logs") },
        { id: "failure-clear", label: card.failure.cleared ? "Undo clear" : "Clear failure", icon: card.failure.cleared ? <Undo2 size={12} aria-hidden /> : <X size={12} aria-hidden />, onSelect: () => actions.run(card, () => recoverCardFailure(card, card.failure?.cleared ? "restore" : "clear", detail?.profileId), card.failure?.cleared ? "Failure restored." : "Failure cleared. History kept; auto stays paused.") },
      ] }] : []),
      ...boardMenuGroups(card, { columns, place, actions, confirm, profile: detail?.profileId }),
    ],
    notePath: card.notePath ?? undefined,
    pending: busy,
  });
  return (
    <>
      <ContextMenu open={open} position={position} groups={taskMenu.groups} onClose={onClose} label={`Card actions for ${card.title}`} />
      {taskMenu.dialogs}
    </>
  );
}
