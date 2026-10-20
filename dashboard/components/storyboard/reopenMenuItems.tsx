import { RotateCcw } from "lucide-react";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";

export type ReopenKind = "reopen" | "reopen-feedback" | "follow-up";

/** Whether a card is closed (completed or closed) and so offers Reopen. */
export function isClosedCard(card: Pick<BoardCard, "taskDone" | "status" | "task">): boolean {
  return !!(card.taskDone || card.task?.done || card.task?.abandonedAt || card.status === "done");
}

/** The one Reopen group Storyboard and Home share. A merged PR offers a follow-up instead of reopening. */
export function reopenMenuGroup(card: BoardCard, onSelect: (kind: ReopenKind) => void): ContextMenuGroup | null {
  if (!isClosedCard(card)) return null;
  const icon = <RotateCcw size={12} aria-hidden />;
  if (card.prState === "merged") return { id: "reopen", items: [{ id: "follow-up", label: "Create follow-up task", icon, onSelect: () => onSelect("follow-up") }] };
  return { id: "reopen", items: [
    { id: "reopen", label: "Reopen", icon, onSelect: () => onSelect("reopen") },
    ...(card.prUrl ? [{ id: "reopen-feedback", label: "Reopen and address feedback", icon, disabled: !card.finishedFeedback, disabledReason: "No new PR feedback since you completed it", onSelect: () => onSelect("reopen-feedback") }] : []),
  ] };
}

export const REOPEN_TOAST: Record<ReopenKind, string> = {
  reopen: "Task reopened.",
  "reopen-feedback": "Task reopened. Addressing feedback.",
  "follow-up": "Follow-up task created.",
};
