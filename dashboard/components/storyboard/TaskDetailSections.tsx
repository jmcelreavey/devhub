"use client";

import Link from "next/link";
import { useState } from "react";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { resetTaskConfirmation } from "./reset-confirmation";
import type { TaskNoteView } from "@shared/task-note/sections.ts";
import { renderInline } from "@/components/notes/task-note/inline";
import { TaskNotePills } from "@/components/notes/task-note/TaskNotePills";
import { useTaskAgentActions } from "@/components/tasks/useTaskAgentActions";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { CheckEvidence, ReviewEvidence, PublicationProposal, type TaskWorkflowResponse } from "@/app/workflow/WorkflowEvidence";
import { WorkflowUpdates } from "@/app/workflow/WorkflowUpdates";
import { RunReceipt } from "@/app/qa/RunReceipt";
import { abandonTask, rerunStep, resetTask, setUiOverride } from "@/app/storyboard/board-actions";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { QaRunRecord } from "@/lib/qa/store";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { AUTO_PHASE_LABEL, STEP_LABEL, checkoutLabel, type OrchestrationSummary } from "@/lib/storyboard/orchestration";
import { tierSummary } from "@/lib/storyboard/model-tiers-shared";
import { agentChatHrefForRun } from "@/lib/tasks/task-agent-resume";
import { ReviewMarkdown } from "./ReviewMarkdown";
import { formatRelative } from "@/lib/utils";
import { RefreshUpdated } from "./RefreshUpdated";
import { mutate } from "swr";
import { costLabel, reviewNotes } from "@/lib/storyboard/work-insights";
import { useTaskCompletion } from "./useTaskCompletion";
import styles from "./TaskDetailPanel.module.css";

export function TaskPlan({ card, view, onOpenNote }: { card: BoardCard; view?: TaskNoteView; onOpenNote: () => void }) {
  return <>
    {view?.summary.length ? view.summary.map((line, index) => <p key={index}>{renderInline(line)}</p>) : card.summary.length ? card.summary.map((line) => <p key={line}>{line}</p>) : <p>No plan summary yet.</p>}
    {view?.decisions.length ? <ul className={styles.list} aria-label="Decisions">{view.decisions.map((decision) => <li key={decision.id}><strong>{decision.title}</strong> {renderInline(decision.body)}</li>)}</ul> : <p>No decisions recorded yet.</p>}
    {view?.waypoints.length ? <ul className={styles.list} aria-label="Waypoints">{view.waypoints.map((waypoint) => <li key={waypoint.id}>{waypoint.done ? "Done" : "To do"} · {waypoint.title}</li>)}</ul> : null}
    <button type="button" className="btn btn-ghost" onClick={onOpenNote}>Read the full plan in the note</button>
  </>;
}

export function TaskActivity({ card, summary, data }: { card: BoardCard; summary?: OrchestrationSummary; data?: TaskWorkflowResponse }) {
  const runs = data?.runs ?? [];
  const history = summary?.auto?.runs ?? [];
  const ids = [...new Set([...history.map((run) => run.runId), ...[...runs].reverse().map((run) => run.runId), ...[...card.steps].reverse().map((step) => step.runId)])];
  const phase = summary?.auto ? AUTO_PHASE_LABEL[summary.auto.phase] : card.auto?.label ?? (summary ? STEP_LABEL[summary.executionStep] : "Not started");
  const cwd = runs.find((run) => run.runId === card.run?.runId)?.cwd ?? runs.find((run) => run.cwd)?.cwd;
  const updatedAt = summary?.updatedAt ?? card.updatedAt;
  const phaseRuns = new Map(history.map((run) => [run.runId, run]));
  const groups: Array<{ key: string; label: string; outcome: string; tone: "ok" | "error" | "active" | "neutral"; at?: string; reason?: string; attempts: Array<{ id: string; label: string; status: string; tier?: string; model?: string; cost?: string }> }> = [];
  for (const id of [...ids].sort((a, b) => Date.parse(phaseRuns.get(a)?.at ?? "") - Date.parse(phaseRuns.get(b)?.at ?? "") || 0)) {
    const step = card.steps.find((item) => item.runId === id);
    const run = runs.find((item) => item.runId === id);
    const phaseRun = phaseRuns.get(id);
    const label = phaseRun ? `${AUTO_PHASE_LABEL[phaseRun.phase]}${phaseRun.round ? ` · round ${phaseRun.round}` : ""}` : step?.label ?? run?.role ?? step?.role ?? "Agent";
    const status = run?.status ?? step?.status ?? "recorded";
    const attempt = { id, label: `Attempt ${(phaseRun?.attempt ?? 0) + 1}`, status, tier: phaseRun?.tier ?? step?.tier ?? run?.tier?.tier, model: step?.model, cost: costLabel(step?.costUsd) || undefined };
    const last = groups.at(-1);
    if (last?.label === label) { last.attempts.push(attempt); last.outcome = status; last.reason = phaseRun?.tierReason ?? step?.tierReason ?? last.reason; }
    else groups.push({ key: id, label, outcome: status, tone: "neutral", at: phaseRun?.at, reason: phaseRun?.tierReason ?? step?.tierReason, attempts: [attempt] });
  }
  for (const group of groups) group.tone = /fail|error/.test(group.outcome) ? "error" : /done|complet|finish/.test(group.outcome) ? "ok" : /running|starting|queued/.test(group.outcome) ? "active" : "neutral";
  return <>
    <p><strong>{phase}</strong> · <RefreshUpdated at={updatedAt} onRefresh={() => mutate((key) => typeof key === "string" && (key.startsWith("/api/storyboard") || key.startsWith("/api/tasks/workflow")))} /></p>
    {summary?.checkout ? <p>{checkoutLabel(summary.checkout)} · {summary.checkout.reason}</p> : null}
    {cwd ? <p>Checkout <code className={styles.path}>{cwd}</code></p> : null}
    {card.repo && cwd ? <Link href={`/repos/${encodeURIComponent(card.repo)}/git?tab=worktrees`}>Open repository checkouts</Link> : null}
    {groups.length ? <ol className={styles.timeline} aria-label="Phase history">{groups.map((group) => <li key={group.key} data-tone={group.tone}>
      <strong>{group.label}</strong>{group.attempts.length > 1 ? ` · ${group.attempts.length} attempts` : ""} · {group.outcome}
      {group.at ? <time dateTime={group.at}>{formatRelative(Date.parse(group.at))}</time> : null}
      {group.reason ? <p>{group.reason}</p> : null}
      <details><summary>{group.attempts.length > 1 ? "Show attempts" : "Show conversation"}</summary>
        <ul className={styles.list}>{group.attempts.map((attempt) => <li key={attempt.id}><Link href={agentChatHrefForRun(attempt.id)}>{attempt.label}</Link> · {attempt.status}{attempt.tier ? ` · ${attempt.tier} tier` : ""}{attempt.model ? ` · ${attempt.model}` : ""}{attempt.cost ? ` · ${attempt.cost}` : ""}</li>)}</ul>
      </details>
    </li>)}</ol> : <p>No agent conversations yet.</p>}
    {data?.workflow ? <WorkflowUpdates events={data.workflow.events} /> : null}
  </>;
}

export function TaskEvidence({ card, summary, data, view, profile, unavailable = false, reviewNotesShown = false, onRefresh }: { profile?: string; onRefresh?: () => void; reviewNotesShown?: boolean; card: BoardCard; summary?: OrchestrationSummary; data?: TaskWorkflowResponse; view?: TaskNoteView; unavailable?: boolean }) {
  const review = reviewNotes(card, data?.workflow);
  const noPreview = !!card.auto?.noPreview || summary?.auto?.preview?.state === "none";
  const noPreviewReason = card.auto?.noPreview ?? summary?.auto?.preview?.reason;
  const skipped = card.auto?.qaSkipped ?? summary?.auto?.qaSkipped;
  const qa = useLive<{ runs: QaRunRecord[] }>(card.jev && !noPreview && !skipped ? "/api/qa" : null, { refreshInterval: 15_000 });
  const run = qa.data?.runs.find((item) => item.id === card.jev?.runId && item.taskId === card.taskId);
  const toast = useToast();
  const [rerunning, setRerunning] = useState<"qa" | "review" | null>(null);
  // Only a task that auto mode has taken to verification can re-run: that is where the checkout it reviews is pinned.
  const canRerun = !card.taskDone && !card.task?.abandonedAt && !isTaskOwnershipBlocked(card.task) && !!summary?.auto && ["ready", "verify"].includes(summary.auto.phase) && !["running", "starting", "paused-manual", "stopped"].includes(summary.status);
  const rerun = async (step: "qa" | "review") => {
    setRerunning(step);
    const result = await rerunStep(card.taskId, step, profile);
    if (!result.ok) toast.error(result.error ?? "Couldn't re-run that.");
    else toast.success(step === "qa" ? "Re-running Jev QA." : "Re-running the review.");
    setRerunning(null);
    onRefresh?.();
  };
  const rerunButton = (step: "qa" | "review", label: string) => canRerun ? <p><button type="button" className="btn btn-ghost" disabled={rerunning !== null} onClick={() => void rerun(step)}>{rerunning === step ? "Starting…" : label}</button></p> : null;
  return <>
    {review && !reviewNotesShown ? <div><h3>Review notes</h3><ReviewMarkdown markdown={review.notes} /></div> : null}
    {summary?.lastError && !card.failure?.cleared ? <p className="tone-panel tone-panel--danger">{summary.lastError}</p> : null}
    {card.prUrl ? <p><strong>{card.title}</strong> · PR {card.prState ?? (card.status === "draft-pr" ? "draft" : "open")}<br /><a href={card.prUrl} target="_blank" rel="noopener noreferrer">{card.prUrl}</a></p> : <p>No pull request linked yet.</p>}
    <h3>Checks</h3><CheckEvidence check={data?.workflow.checks.at(-1)} empty={unavailable ? "Check evidence is unavailable. Refresh before relying on it." : undefined} />
    <h3>Independent review</h3><ReviewEvidence review={data?.workflow.reviews.at(-1)} hideFindings={!!review && review.runId === data?.workflow.reviews.at(-1)?.runId} />
    {!data?.workflow.reviews.length ? <p>{unavailable ? "Review evidence is unavailable." : "No independent review recorded yet."}</p> : null}
    {rerunButton("review", "Re-run review")}
    {view?.bugs.some((bug) => bug.status !== "open") ? <details className={styles.resolved}>
      <summary>Resolved findings ({view.bugs.filter((bug) => bug.status !== "open").length})</summary>
      <ul className={styles.list} aria-label="Resolved findings">{view.bugs.filter((bug) => bug.status !== "open").map((bug) => <li key={bug.id}>
        <strong>{bug.status === "fixed" ? "Fixed" : "Won't fix"} · {bug.title}</strong>
        {bug.resolution ? <p>{bug.resolution}</p> : <p className="text-text-muted">No summary recorded.</p>}
      </li>)}</ul>
    </details> : null}
    {view?.bugs.filter((bug) => bug.status === "open").length ? <ul className={styles.list} aria-label="Open findings">{view.bugs.filter((bug) => bug.status === "open").map((bug) => <li key={bug.id}><strong>{bug.severity ?? "Open"} · {bug.title}</strong>{bug.details ? <p>{bug.details}</p> : null}</li>)}</ul> : null}
    <h3>Jev QA</h3>
    {noPreview ? <p className="tone-panel tone-panel--muted">QA skipped — no preview{noPreviewReason ? ` · ${noPreviewReason}` : ""}</p>
      : skipped ? <p className="tone-panel tone-panel--muted">QA skipped — {skipped}</p>
      : card.jev ? <>
        <p>QA {card.jev.status} · {card.jev.bugCount} {card.jev.bugCount === 1 ? "finding" : "findings"}</p>
        <div className={styles.links}>
          {card.jev.beforeVideo ? <a href={card.jev.beforeVideo} target="_blank" rel="noopener noreferrer">Before video</a> : null}
          {card.jev.afterVideo ? <a href={card.jev.afterVideo} target="_blank" rel="noopener noreferrer">After video</a> : null}
          <Link href={card.jev.receiptHref}>QA receipt</Link>
        </div>
        {qa.error ? <FetchError bare message="Couldn't refresh the QA receipt. The last result is shown." onRetry={() => void qa.mutate()} /> : null}
        {run ? <RunReceipt run={run} /> : !qa.data && !qa.error ? <SkeletonRows count={2} height={48} /> : <p>Full receipt unavailable here. Open the QA receipt to inspect this run.</p>}
      </> : <p>{card.auto?.previewStarting || summary?.auto?.preview?.state === "starting" ? "Starting the preview for Jev…" : "QA not recorded."}</p>}
    {rerunButton("qa", "Re-run QA")}
    {(noPreview || skipped) && card.jev ? <Link href={card.jev.receiptHref}>Previous QA receipt</Link> : null}
    {data?.workflow.proposals.length ? <><h3>Publication decisions</h3><p>Review the exact proposal in the guarded approval page. Nothing is approved from this panel.</p>{data.workflow.proposals.map((proposal) => <PublicationProposal key={proposal.id} proposal={proposal} />)}</> : null}
  </>;
}

function AgentControls({ card, onRefresh }: { card: BoardCard & { task: NonNullable<BoardCard["task"]> }; onRefresh: () => void }) {
  const complete = useTaskCompletion();
  const toast = useToast();
  const agent = useTaskAgentActions({ task: card.task, date: card.date, enabled: !card.taskDone && !card.task.abandonedAt, repoName: card.repo, onComplete: () => void complete(card), onAbandon: (reason) => void abandonTask(card.taskId, reason).then((result) => { if (!result.ok) toast.error(result.error ?? "Couldn't abandon the task."); onRefresh(); }), onAutoStarted: onRefresh });
  const items = agent.menuItems.filter((item) => ["plan-agent", "implement-agent", "resume-agent", "start-auto-tiers", "start-auto-without-review", "copy-plan", "auto-mode"].includes(item.id));
  return <>
    <div className={styles.links}>{items.map((item) => <button type="button" key={item.id} className="btn btn-ghost" disabled={item.disabled} onClick={() => void item.onSelect()}>{item.label}</button>)}</div>
    {agent.dialogs}
  </>;
}

export function TaskControls({ card, summary, pending, onRefresh, profile }: { profile?: string; card: BoardCard; summary?: OrchestrationSummary; pending: boolean; onRefresh: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ui = card.auto?.ui;
  const ownershipBlocked = isTaskOwnershipBlocked(card.task);
  const setUi = async (value: boolean | null) => {
    if (busy || pending) return;
    setBusy(true);
    const result = await setUiOverride(card.taskId, value, profile);
    if (!result.ok) toast.error(result.error ?? "Couldn't update UI detection.");
    setBusy(false);
    onRefresh();
  };
  return <>
    <TaskNotePills openQuestions={0} tags={card.tags} links={card.links} models={card.models} />
    {card.task?.jiraKey ? <p>Jira: {card.task.jiraKey}. Finish only completes the DevHub task; it does not transition Jira or merge the PR.</p> : <p>Finish only completes the DevHub task. It does not merge a PR.</p>}
    {summary?.tiers ? <p>Task tiers: {tierSummary(summary.tiers)}</p> : card.tiers ? <p>{card.tiers.map((entry) => `${STEP_LABEL[entry.step]} ${entry.tier} · ${entry.label}`).join(" · ")}</p> : null}
    {card.auto && !ownershipBlocked ? <label className={styles.check}><input type="checkbox" checked={ui?.value ?? false} disabled={busy || pending} onChange={(event) => void setUi(ui && event.target.checked === ui.detected ? null : event.target.checked)} /> Changes the UI (Jev records before and after videos)</label> : null}
    {ui && !ownershipBlocked ? <p>{ui.override !== undefined ? <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => void setUi(null)}>Use UI detection</button> : `Detected: ${ui.reason}`}</p> : null}
    {card.task && !ownershipBlocked ? <AgentControls card={{ ...card, task: card.task }} onRefresh={onRefresh} /> : null}
    {card.task && !card.taskDone && !card.task.abandonedAt && !ownershipBlocked ? <ResetControls card={card} profile={profile} pending={pending} onRefresh={onRefresh} /> : null}
  </>;
}

/** Undo a task's work: back to To do, keeping the task and note. Discarding also deletes the agent's checkouts and local branches. */
export function ResetControls({ card, onRefresh, profile, pending = false }: { profile?: string; pending?: boolean; card: BoardCard; onRefresh: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const run = async (discard: boolean) => {
    if (busy || pending || !await confirm(resetTaskConfirmation(discard))) return;
    setBusy(true);
    const result = await resetTask(card.taskId, discard, profile);
    if (!result.ok) toast.error(result.error ?? "Couldn't reset the task.");
    else if (result.warning) toast.info(result.warning);
    else toast.success(discard ? "Work discarded. Task is back on To do." : "Task is back on To do.");
    setBusy(false);
    onRefresh();
  };
  return <div className={styles.links}>
    <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => void run(false)}>Reset to To do</button>
    <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => void run(true)}>Discard work and reset</button>
  </div>;
}
