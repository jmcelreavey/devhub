"use client";

import { useState, type MouseEvent } from "react";
import { canSwitchMode, isManual, type OrchestrationSummary } from "@/lib/storyboard/orchestration";
import { useToast } from "@/lib/hooks/use-toast";
import { postOrchestrate } from "./orchestrate-client";

type Toast = ReturnType<typeof useToast>;

/** Flip a task between Auto and Manual and say what happened. Shared by the switch and the task menu. */
export async function switchAutoMode(taskId: string, next: "auto" | "manual", toast: Toast): Promise<boolean> {
  const result = await postOrchestrate({ action: "mode", taskId, mode: next });
  if (!result.ok) {
    toast.error(result.error ?? "Couldn't switch mode");
    return false;
  }
  if (next === "manual") {
    if (result.cancelled?.startsWith("failed")) toast.error(`Manual, but the run did not stop: ${result.cancelled.slice("failed: ".length)}`);
    else if (result.cancelled === "not-cancellable") toast.info("Manual: auto is paused, but this run can't be stopped from DevHub");
    else toast.success(result.cancelled === "signalled" || result.cancelled === "cancelled" ? "Manual: the active run was stopped" : "Manual: auto is paused");
  } else if (result.dispatchError) toast.error(`Couldn't resume auto: ${result.dispatchError}`);
  else toast.success(result.runId ? "Auto: resumed with a new run" : "Auto: resumed");
  return true;
}

/**
 * Auto/Manual switch for a task on auto. One click, no confirm: Manual cancels
 * the active run and parks the task; Auto resumes it with a fresh run.
 */
export function AutoModeSwitch({ summary, compact = false }: { summary: Pick<OrchestrationSummary, "taskId" | "status" | "runCount">; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!canSwitchMode(summary)) return null;
  const manual = isManual(summary);
  const next = manual ? "auto" : "manual";

  const flip = async (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    await switchAutoMode(summary.taskId, next, toast);
    setBusy(false);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!manual}
      aria-label={manual ? "Manual. Switch back to Auto" : "Auto. Switch to Manual"}
      title={manual ? "Manual — click to resume auto" : "Auto — click to stop the run and take over"}
      className="task-agent-chip auto-mode-switch"
      data-kind={manual ? "paused" : "running"}
      data-mode={manual ? "manual" : "auto"}
      data-compact={compact || undefined}
      disabled={busy}
      onClick={(event) => void flip(event)}
    >
      <span aria-hidden className="auto-mode-switch-track"><span className="auto-mode-switch-thumb" /></span>
      {busy ? "Switching…" : manual ? "Manual" : "Auto"}
    </button>
  );
}
