"use client";

import { mutate } from "swr";
import { Check, X } from "lucide-react";
import { abandonTask, reactivateTask, reopenCard, stopTaskWork } from "@/app/storyboard/board-actions";
import { REOPEN_TOAST, reopenMenuGroup, type ReopenKind } from "@/components/storyboard/reopenMenuItems";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import { useTaskCompletion } from "@/components/storyboard/useTaskCompletion";
import { useToast } from "@/lib/hooks/use-toast";
import { hasLiveWork } from "@/lib/storyboard/next-action";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { runTaskAction, useTaskActionPending } from "@/lib/storyboard/task-action";

export function useHomeTaskActions(card: BoardCard, profile?: string, showComplete = true) {
  const toast = useToast();
  const completeTask = useTaskCompletion(profile);
  const pending = useTaskActionPending(card.taskId, profile);
  const live = hasLiveWork(card);
  const open = !(card.taskDone || card.task?.done || card.task?.abandonedAt || card.task?.endDate || card.task?.movedAt);
  const refresh = () => mutate((key) => typeof key === "string" && ["/api/storyboard", "/api/tasks", "/api/sidebar/counts"].some((prefix) => key.startsWith(prefix)));
  const complete = () => { if (open && !pending) void completeTask(card); };
  const close = async (reason?: string) => {
    if (!open || pending) return;
    // Abandon only updates task storage, so a live run is stopped first, after one Confirm.
    if (live && !window.confirm("Stop the run and close? Undo restores the task, not the run.")) return;
    const result = await runTaskAction(card.taskId, "home-close", async () => {
      if (live) {
        const stopped = await stopTaskWork(card.taskId, profile);
        if (!stopped.ok) return stopped;
      }
      return abandonTask(card.taskId, reason, card.date, profile);
    }, profile);
    if (!result.ok) toast.error(result.error ?? "Couldn't close the task.");
    else toast.success("Task closed.", { duration: 7000, action: { label: "Undo", onClick: async () => {
      const restored = await runTaskAction(card.taskId, "undo-close", () => reactivateTask(card.taskId, card.date, profile), profile);
      if (!restored.ok) toast.error(restored.error ?? "Couldn't restore the task.");
      await refresh();
    } } });
    await refresh();
  };
  const reopen = async (kind: ReopenKind) => {
    if (pending) return;
    const result = await reopenCard(card, kind, profile);
    if (!result.ok) toast.error(result.error ?? "Couldn't reopen the task.");
    else toast.success(REOPEN_TOAST[kind]);
    await refresh();
  };
  const reopenGroup = open ? null : reopenMenuGroup(card, (kind) => void reopen(kind));
  const groups = (shared: ContextMenuGroup[]): ContextMenuGroup[] => [
    ...(reopenGroup ? [reopenGroup] : []),
    ...(open ? [{ id: "home-completion", items: [{ id: "complete", label: "Complete", icon: <Check size={12} aria-hidden />, disabled: pending || live, disabledReason: live ? "Stop running work before completing this task" : undefined, onSelect: complete }] }] : []),
    ...shared.map((group) => ({ ...group, items: group.items.filter((item) => item.id !== "complete-merged").map((item) => {
      if (item.id === "abandon") return { ...item, label: "Close", onSelect: () => void close() };
      if (item.id === "abandon-closed") return { ...item, label: "Close (PR closed)" };
      if (item.id === "reactivate") return { ...item, label: "Reopen" };
      return item;
    }) })),
  ];
  const controls = open ? <>
    {showComplete ? <button type="button" className="btn btn-ghost" aria-label={`Complete ${card.title}`} title={live ? "Stop running work before completing this task" : "Complete"} disabled={pending || live} onClick={complete}><Check size={14} aria-hidden /></button> : null}
    <button type="button" className="btn btn-ghost" aria-label={`Close ${card.title}`} title="Close" disabled={pending} onClick={() => void close()}><X size={14} aria-hidden /></button>
  </> : null;
  return { complete, close, reopen, groups, controls };
}
