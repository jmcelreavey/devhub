"use client";

import { mutate } from "swr";
import { useCallback } from "react";
import { completeTask, undoCompleteTask } from "@/app/storyboard/board-actions";
import { useToast } from "@/lib/hooks/use-toast";
import { hasLiveWork } from "@/lib/storyboard/next-action";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { runTaskAction } from "@/lib/storyboard/task-action";

type CompletionTarget = Pick<BoardCard, "taskId" | "date"> & Partial<Pick<BoardCard, "run" | "steps" | "auto">>;

export function useTaskCompletion(profile?: string) {
  const toast = useToast();
  return useCallback((card: CompletionTarget) => runTaskAction(card.taskId, "finish", async () => {
    if (hasLiveWork(card)) {
      const error = "Work is still running. Wait for it to finish or stop it before finishing this task.";
      toast.info(error);
      return { ok: false, error };
    }
    const result = await completeTask(card.taskId, card.date, profile);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't finish the task.");
      return result;
    }
    void mutate((key) => typeof key === "string" && key.startsWith("/api/storyboard"));
    toast.success("Task done.", {
      duration: 7000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undone = await undoCompleteTask(card.taskId, card.date, profile);
          if (!undone.ok) toast.error(undone.error ?? "Couldn't undo completion.");
          else toast.success("Task reopened.");
          void mutate((key) => typeof key === "string" && key.startsWith("/api/storyboard"));
        },
      },
    });
    return result;
  }, profile), [toast, profile]);
}
