"use client";

import Link from "next/link";
import { AutoModeSwitch } from "@/components/storyboard/AutoModeSwitch";
import { RepoAnswer } from "@/components/storyboard/RepoAnswer";
import { autoProgress } from "@/lib/storyboard/auto-phase";
import { checkoutLabel, ORCHESTRATION_STATUS_LABEL, isOrchestrating, orchestrationChip, STEP_LABEL, type OrchestrationSummary } from "@/lib/storyboard/orchestration";
import { useOrchestrations } from "@/lib/storyboard/use-orchestrations";
import styles from "./storyboard.module.css";

/**
 * Live Orchestrator state in the Storyboard header. Scoped to the task in the
 * URL when there is one, otherwise a count of tasks on auto. Start lives on the
 * task's menu in Tasks — the one click that opts a task in.
 */
export function OrchestratorStatus({ ticket, progress, knownTaskIds }: { ticket: string; progress?: string; /** Tasks on this board. Records belong to every profile, so the count only includes the ones you can see. */ knownTaskIds?: ReadonlySet<string> }) {
  const { data, error } = useOrchestrations();
  if (error || data?.errors.length) {
    return <span className={styles.orchestrator} data-state="unavailable" role="status"
      title={error?.message ?? data?.errors.join("; ")}>
      Auto · {data ? "status incomplete" : "unavailable"}
    </span>;
  }
  if (!data) return <span className={styles.orchestrator} data-state="loading" aria-busy="true">Auto</span>;
  const summary = ticket ? data.orchestrations.find((item) => item.taskId === ticket) : undefined;
  if (summary?.auto && isOrchestrating(summary.status)) return <AutoStatus summary={summary} auto={summary.auto} progress={progress} />;
  if (summary) {
    const chip = orchestrationChip(summary);
    const needsRepo = summary.status === "needs-you" && summary.runCount === 0;
    const retry = summary.status === "paused" && summary.runCount === 0;
    const manualError = summary.status === "paused-manual" ? summary.lastError : undefined;
    const orchestrationNotice = !retry && !manualError ? summary.lastError : undefined;
    return (
      <div className={styles.orchestratorGroup} role="status" aria-live="polite">
        <span className="task-agent-chip" data-kind={chip?.kind} title={chip?.detail}>
          Auto · {chip?.label ?? ORCHESTRATION_STATUS_LABEL[summary.status]}
        </span>
        <AutoModeSwitch summary={summary} />
        <span className={styles.orchestratorStep}>Step: {STEP_LABEL[summary.executionStep]}</span>
        {summary.checkout && <span className={styles.orchestratorStep} data-checkout={summary.checkout.mode} title={summary.checkout.reason}>{checkoutLabel(summary.checkout)}</span>}
        {retry && <Link className="btn btn-ghost" href="/work?tab=tasks">Open Tasks</Link>}
        {summary.prUrl && <a className="btn btn-ghost" href={summary.prUrl} target="_blank" rel="noreferrer">Open PR</a>}
        {needsRepo && <span className={styles.orchestratorNotice}>Pick the repo this task should run in. It gets linked to the task and planning resumes.</span>}
        {needsRepo && <RepoAnswer taskId={summary.taskId} taskDate={summary.taskDate} repoName={summary.repoName} />}
        {retry && <span className={styles.orchestratorNotice}>{summary.lastError ?? "Planning did not start."} Retry on auto from the task menu.</span>}
        {manualError && <span className={styles.orchestratorNotice}>{manualError} Switch to Auto to retry.</span>}
        {orchestrationNotice && <span className={styles.orchestratorNotice}>{orchestrationNotice}</span>}
      </div>
    );
  }
  if (ticket) return <span className={styles.orchestrator} data-state="idle">Auto · not started</span>;
  // Only tasks auto mode is actually driving or waiting on John for. Manual, finished and failed-to-start records are history, not "tasks on auto".
  const active = data.orchestrations.filter((item) => item.auto && ["starting", "running", "needs-you"].includes(item.status) && (!knownTaskIds || knownTaskIds.has(item.taskId)));
  const waiting = active.filter((item) => item.status === "needs-you").length;
  const running = active.filter((item) => orchestrationChip(item)?.kind === "running").length;
  return (
    <span className={styles.orchestrator} data-state={running ? "active" : "idle"} role="status" aria-live="polite"
      title={active.length ? "Scope to a task to see its step." : "Start a task on auto from its menu in Tasks."}>
      Auto · {active.length ? [running ? `${running} running` : "", waiting ? `${waiting} need${waiting === 1 ? "s" : ""} you` : ""].filter(Boolean).join(" · ") || `${active.length} task${active.length === 1 ? "" : "s"}` : "idle"}
    </span>
  );
}

/**
 * A task on auto: one progress line, the same words as its card (the board passes the card's own line in
 * `progress`, so the two cannot disagree), plus where the code runs once Build has decided it.
 */
function AutoStatus({ summary, auto, progress }: { summary: OrchestrationSummary; auto: NonNullable<OrchestrationSummary["auto"]>; progress?: string }) {
  const chip = orchestrationChip(summary);
  const paused = ["paused", "paused-manual", "needs-you"].includes(summary.status);
  const line = (!paused && progress) || autoProgress({ ...auto, status: summary.status });
  const retry = summary.status === "paused" && summary.runCount === 0;
  const needsRepo = summary.status === "needs-you" && summary.runCount === 0;
  const manualError = summary.status === "paused-manual" ? summary.lastError : undefined;
  const where = summary.checkout ? (summary.checkout.mode === "worktree" ? "Worktree" : "Checkout") : null;
  return (
    <div className={styles.orchestratorGroup} role="status" aria-live="polite">
      <span className="task-agent-chip" data-kind={chip?.kind} data-progress title={summary.checkout ? checkoutLabel(summary.checkout) : chip?.detail}>
        {line}{where ? ` · ${where}` : ""}
      </span>
      <AutoModeSwitch summary={summary} />
      {needsRepo && <span className={styles.orchestratorNotice}>Pick the repo this task should run in. It gets linked to the task and planning resumes.</span>}
      {needsRepo && <RepoAnswer taskId={summary.taskId} taskDate={summary.taskDate} repoName={summary.repoName} />}
      {manualError && <span className={styles.orchestratorNotice}>{manualError} Switch to Auto to retry.</span>}
      {retry && <Link className="btn btn-ghost" href="/work?tab=tasks">Open Tasks</Link>}
      {!needsRepo && !manualError && (paused || auto.waiting) && summary.lastError ? <span className={styles.orchestratorNotice}>{summary.lastError}{retry ? " Retry on auto from the task menu." : ""}</span> : null}
    </div>
  );
}
