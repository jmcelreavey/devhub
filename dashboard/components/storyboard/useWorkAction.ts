"use client";

import { mutate } from "swr";
import { createPr, decidePlan, recoverCardFailure, clearRun, retryAuto, retryCard, startAuto, reopenCard } from "@/app/storyboard/board-actions";
import { useToast } from "@/lib/hooks/use-toast";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { NextAction } from "@/lib/storyboard/next-action";
import { requestStartOnAuto } from "@/lib/storyboard/start-on-auto-request";
import { useTaskCompletion } from "./useTaskCompletion";

export function useWorkAction(profile?: string) {
  const complete = useTaskCompletion(profile);
  const toast = useToast();
  return async (card: BoardCard, action: NextAction) => {
    if (action.kind === "finish" || action.kind === "done") return complete(card);
    // Start on auto opens the launch sheet (Run on auto checked) so the model, instructions and worktree can change first.
    if (action.kind === "start-auto" && requestStartOnAuto(card)) return { ok: true };
    const result = ["reopen", "reopen-feedback", "follow-up"].includes(action.kind) ? await reopenCard(card, action.kind as "reopen" | "reopen-feedback" | "follow-up", profile)
      : card.failure && (action.kind === "retry" || action.kind === "auto-retry") ? await recoverCardFailure(card, "retry", profile)
      : action.kind === "approve-plan" ? await decidePlan(card, "approve", profile)
      : action.kind === "create-pr" ? await createPr(card, profile)
      : action.kind === "start-auto" ? await startAuto(card, { pauseAfterPlan: action.pauseAfterPlan ?? true }, profile)
      : action.kind === "retry" ? await retryCard(card, profile)
      : action.kind === "auto-retry" ? await retryAuto(card.taskId, profile)
      : action.kind === "clear" && action.attention.action.kind === "clear" ? await clearRun(card.taskId, action.attention.action.runId, profile)
      : { ok: false, error: "Open the task details to continue." };
    if (result.ok) toast.success(action.kind === "create-pr" ? "Creating the draft PR. The PR is tagged on the task when it opens." : action.kind === "follow-up" ? "Follow-up task created." : action.kind === "reopen-feedback" ? "Task reopened. Addressing feedback." : action.kind === "reopen" ? "Task reopened." : action.kind === "start-auto" ? "On auto." : action.label === "One more round" ? "One more fix round." : "Task updated.");
    else toast.error(result.error ?? "Couldn't update the task.");
    void mutate((key) => typeof key === "string" && (key.startsWith("/api/storyboard") || key.startsWith("/api/tasks/workflow") || key.startsWith("/api/sidebar/counts")));
    return result;
  };
}
