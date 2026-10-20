"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { TaskNoteQuestions } from "@/components/notes/task-note/TaskNoteQuestions";
import { submitTaskNoteOperation, taskNoteSectionsKey } from "@/components/notes/task-note/task-note-operation";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import { notesPageHref } from "@/lib/notes/path";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { profileKey } from "@/lib/tasks/profile-scope";
import type { BoardCard, NotesBoard } from "@/lib/storyboard/notes-board-shared";
import { type NextAction } from "@/lib/storyboard/next-action";
import { reviewNotes } from "@/lib/storyboard/work-insights";
import { resolveWorkPresentation } from "@/lib/storyboard/work-summary";
import { sectionForTaskAction, type TaskDetailSection } from "@/lib/storyboard/task-detail";
import { useOrchestrations } from "@/lib/storyboard/use-orchestrations";
import { useTaskActionPending } from "@/lib/storyboard/task-action";
import { tierStepForPhase } from "@/lib/storyboard/auto-tiers";
import { choiceForStep, describeTierChoice, TIER_LABEL } from "@/lib/storyboard/model-tiers-shared";
import type { TaskWorkflow } from "@/lib/workflows/types";
import type { TaskWorkflowResponse } from "@/app/workflow/WorkflowEvidence";
import type { TaskNoteOp } from "@shared/task-note/sections.ts";
import type { UpdateTaskNoteResult } from "@shared/task-note/update.ts";
import { buildTaskReviewMessage, copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";
import { askBack } from "@/app/storyboard/board-actions";
import { agentChatHrefForRun } from "@/lib/tasks/task-agent-resume";
import { TaskContext } from "./TaskContext";
import { PlanApproval } from "./PlanApproval";
import { TaskFailure } from "./TaskFailure";
import { TaskCost } from "./TaskCost";
import { RepoAnswer } from "./RepoAnswer";
import { ReviewMarkdown } from "./ReviewMarkdown";
import { WorkActionButton } from "./WorkActionButton";
import { useWorkAction } from "./useWorkAction";
import { TaskActivity, TaskControls, TaskEvidence, TaskPlan } from "./TaskDetailSections";
import { WorkDetailFrame } from "./WorkDetailFrame";
import styles from "./TaskDetailPanel.module.css";

const VaultEditorPage = dynamic(() => import("@/components/vault/VaultEditorPage").then((module) => module.VaultEditorPage), { ssr: false, loading: () => <SkeletonRows count={4} /> });

interface TaskDetailPanelProps {
  taskId: string;
  board?: NotesBoard;
  boardError?: Error;
  workflow?: TaskWorkflow;
  requestedSection?: TaskDetailSection;
  requestedProfile?: string;
  onClose: () => void;
  onRefresh: () => void;
}

export function TaskDetailPanel({ taskId, board, boardError, workflow, requestedSection, requestedProfile, onClose, onRefresh }: TaskDetailPanelProps) {
  const current = board?.cards.find((card) => card.taskId === taskId);
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  const profileId = profile.data ? profile.data.active ?? "legacy" : undefined;
  const [openedProfile, setOpenedProfile] = useState(requestedProfile ?? profileId);
  if (profileId !== undefined && openedProfile === undefined) setOpenedProfile(profileId);
  const mismatch = openedProfile !== undefined && profileId !== undefined && openedProfile !== profileId;
  const archived = useLive<NotesBoard>(board && !current && !mismatch ? profileKey("/api/storyboard?done=all", profileId) : null, { refreshInterval: 15_000, keepPreviousData: false });
  const card = current ?? archived.data?.cards.find((item) => item.taskId === taskId);
  const title = mismatch ? "Task profile changed" : card?.title ?? "Task details";
  return (
    <WorkDetailFrame title={title} onClose={onClose}>
          {mismatch ? <p role="alert" className="tone-panel tone-panel--warning">This detail was opened in {openedProfile}, but the active profile is now {profileId}. Close it and open a task in the active profile.</p>
            : profile.error ? <FetchError bare message="Couldn't confirm the active task profile." onRetry={() => void profile.mutate()} />
            : !profile.data || openedProfile === undefined ? <div aria-label="Loading task profile" aria-busy="true"><SkeletonRows count={3} /></div>
            : boardError || archived.error ? <FetchError bare message="Couldn't refresh this task. Refresh before acting on it." onRetry={() => { onRefresh(); void archived.mutate(); }} />
            : card ? <TaskDetailBody card={card} profileId={profileId} now={Date.parse((current ? board : archived.data)?.generatedAt ?? card.updatedAt)} workflow={workflow} requestedSection={requestedSection} onRefresh={onRefresh} />
            : !board || !archived.data ? <div aria-label="Loading task details" aria-busy="true"><SkeletonRows count={4} /></div>
            : <p role="status">This task isn’t available in the active profile. It may have moved or belong to another profile. Close this panel or switch profiles to find it.</p>}
    </WorkDetailFrame>
  );
}

function TaskDetailBody({ card, profileId, now, workflow: cachedWorkflow, requestedSection, onRefresh }: { card: BoardCard; profileId?: string; now: number; workflow?: TaskWorkflow; requestedSection?: TaskDetailSection; onRefresh: () => void }) {
  const workflow = useLive<TaskWorkflowResponse>(profileKey(`/api/tasks/workflow?taskId=${encodeURIComponent(card.taskId)}`, profileId), { refreshInterval: 5000 });
  const note = useLive<UpdateTaskNoteResult>(card.notePath ? profileKey(taskNoteSectionsKey(card.notePath), profileId) : null, { refreshInterval: 4000 });
  const orchestrations = useOrchestrations();
  const summary = orchestrations.data?.orchestrations.find((item) => item.taskId === card.taskId);
  const presentation = resolveWorkPresentation(card, workflow.data?.workflow ?? cachedWorkflow, now);
  const action = presentation.action;
  // The review is shown (embedded) whenever it is what the card is about: waiting to be opened, approved for a PR, or approved with the PR already open.
  const review = action?.label === "Open review" || action?.kind === "create-pr" || (!action && presentation.needsYou) ? reviewNotes(card, workflow.data?.workflow ?? cachedWorkflow) : undefined;
  const noCodeReview = !!review && /\+0\/-0 across 0 files|no code (?:has )?changed|note-only/i.test(review.notes);
  const reviewPath = review?.notes.match(/\bpr-reviews\/[A-Za-z0-9._-]+/)?.[0];
  const pending = useTaskActionPending(card.taskId, profileId);
  const perform = useWorkAction(profileId);
  const [failure, setFailure] = useState("");
  const toast = useToast();
  const [saved, setSaved] = useState<{ auto: boolean; updatedAt: string }>();
  const target = (requestedSection === "revise-plan" ? "plan" : requestedSection) ?? sectionForTaskAction(action);
  const [choice, setChoice] = useState<{ target: TaskDetailSection; section: TaskDetailSection | null }>();
  const expanded = choice?.target === target ? choice.section : target;
  const rootRef = useRef<HTMLDivElement>(null);
  const view = note.data?.view;
  const questions = view?.questions.filter((question) => !question.resolved) ?? [];
  const autoOn = !!(summary?.auto ?? card.auto) && !["paused-manual", "stopped"].includes(summary?.status ?? card.auto?.status ?? "");
  const resumed = saved && summary && summary.updatedAt !== saved.updatedAt && ["running", "starting", "ready-for-review"].includes(summary.status) && summary.auto?.waiting?.kind !== "questions";
  const interrupted = saved && summary && summary.updatedAt !== saved.updatedAt && ["paused", "needs-you"].includes(summary.status) && summary.auto?.waiting?.kind !== "questions";
  const awaitingPlanApproval = summary?.auto?.waiting?.kind === "plan-approval";
  const savedMessage = questions.length > 0 ? `Answer saved · ${questions.length} ${questions.length === 1 ? "question remains" : "questions remain"}`
    : !saved?.auto ? "Answer saved" : awaitingPlanApproval ? "Answer saved · planning is done. This task pauses after the plan, so approve it to continue." : !autoOn ? "Answer saved · auto paused" : resumed ? "Answer saved · resumed" : interrupted ? "Answer saved · resume needs attention" : "Answer saved · resuming";
  const focusReady = target !== "answer" || !!view;

  useEffect(() => {
    if (!focusReady) return;
    const root = rootRef.current;
    const destination = requestedSection === "revise-plan" ? root?.querySelector<HTMLElement>("[data-task-primary] textarea")
      : target === "answer" ? root?.querySelector<HTMLElement>('[data-question="open"] input')
      : target === "repo" ? root?.querySelector<HTMLElement>('[data-task-primary] select, [data-task-primary] input')
      : root?.querySelector<HTMLElement>(`[data-task-section="${target}"] > summary`);
    (destination ?? root?.querySelector<HTMLElement>("[data-task-primary]"))?.focus();
  }, [target, focusReady, requestedSection]);

  // Only a task on auto that is waiting on answers can send the agent a question back: that is what runs it again.
  const askBackFn = summary?.status === "needs-you" && summary.auto?.waiting?.kind === "questions" ? async (text: string) => {
    const result = await askBack(card.taskId, text, profileId);
    await Promise.allSettled([orchestrations.mutate(), note.mutate()]);
    onRefresh();
    if (!result.ok) throw new Error(result.error ?? "Couldn't send that question.");
    return true;
  } : undefined;
  const answer = async (op: TaskNoteOp) => {
    if (!card.notePath) return false;
    const result = await submitTaskNoteOperation(card.notePath, op, profileId);
    if (op.op === "resolve_question" && !op.reopen) setSaved({ auto: autoOn, updatedAt: summary?.updatedAt ?? card.updatedAt });
    // Let auto mode notice the answer first, so the card and board drop "Answer" in one refresh instead of lingering.
    await Promise.allSettled([orchestrations.mutate(), note.mutate()]);
    onRefresh();
    return !!result;
  };

  const act = async (next: NextAction) => {
    setFailure("");
    const result = await perform(card, next);
    if (!result.ok) setFailure(result.error ?? "Couldn't confirm the update. Refresh before retrying.");
    onRefresh();
  };
  const select = (section: TaskDetailSection) => setChoice({ target, section: expanded === section ? null : section });
  const section = (id: TaskDetailSection, label: string, children: ReactNode) => <details className={styles.section} data-task-section={id} open={expanded === id}>
    <summary onClick={(event) => { event.preventDefault(); select(id); }}>{label}</summary>
    {expanded === id ? <div className={styles.sectionBody}>{children}</div> : null}
  </details>;
  const workflowHref = `/workflow?taskId=${encodeURIComponent(card.taskId)}`;
  const conversationId = card.run?.runId ?? summary?.auto?.runs.at(-1)?.runId;
  const lastAutoRun = summary?.auto?.runs.at(-1);
  const retryBaseline = summary?.tiers && summary.auto ? choiceForStep(summary.tiers, tierStepForPhase(summary.auto.phase)) : undefined;
  const mainAction = action?.kind === "review" ? { ...action, label: action.external ? "Open PR" : "Open workflow" }
    : action?.kind === "progress" ? { ...action, label: conversationId ? "Open conversation" : "Open workflow", href: conversationId ? agentChatHrefForRun(conversationId) : workflowHref }
    : action;

  return <div ref={rootRef}>
    <div className={styles.context}>
      {card.repo ? <Link href={`/repos/${encodeURIComponent(card.repo)}`}>{card.repo}</Link> : null}
      {card.jira?.map((key) => <span key={key}>{key}</span>)}
    </div>
    <TaskContext card={card} view={view} />
    {!review && !(card.failure?.cleared && action?.kind !== "answer" && action?.kind !== "approve-plan") ? <p className={styles.status}>{presentation.status}</p> : null}
    <section className={styles.primary} data-task-primary tabIndex={-1} aria-label="Next action">
      {/* The review note itself is embedded below when there is one; the pasted summary only covers a review with no note. */}
      {review && !reviewPath ? <div><h3>Review notes</h3><ReviewMarkdown markdown={review.notes} /></div> : null}
      {/* Open questions stay answerable here whatever else leads, so a failure or plan card never hides them. */}
      {action?.kind !== "answer" && view && questions.length > 0 ? <section aria-label="Open questions"><TaskNoteQuestions questions={view.questions} onOp={answer} onAskBack={askBackFn} includeResolved={false} />{card.notePath ? <p className={styles.questionNoteLink}><Link href={`${notesPageHref(card.notePath)}#task-note-questions`}>Answer in the plan note <ExternalLink size={11} aria-hidden /></Link></p> : null}{conversationId ? <p className={styles.questionNoteLink}><Link href={agentChatHrefForRun(conversationId)}>Ask the agent in chat first <ExternalLink size={11} aria-hidden /></Link></p> : null}</section> : null}
      {action?.kind === "approve-plan" ? <PlanApproval key={`${card.auto?.planRunId}-${requestedSection}`} card={card} profile={profileId} onRefresh={onRefresh} revise={requestedSection === "revise-plan"} /> : card.failure && action?.kind !== "answer" ? <TaskFailure key={requestedSection} card={card} profile={profileId} onRefresh={onRefresh} requestedSection={requestedSection} /> : action?.kind === "choose-repo" ? <><p>Pick the repo this task should run in. Your selection links it and resumes planning.</p><RepoAnswer taskId={card.taskId} taskDate={card.date} repoName={card.repo ?? summary?.repoName} onAnswered={onRefresh} /></>
        : action?.kind === "answer" ? <>
          {note.error ? <FetchError bare message="Couldn't refresh the task questions. Your answer will stay here." onRetry={() => void note.mutate()} /> : null}
          {!view && !note.error ? <SkeletonRows count={2} height={40} /> : view ? <>
            {questions.length > 1 ? <p className={styles.questionCount}>{questions.length} questions need answers</p> : null}
            <TaskNoteQuestions questions={view.questions} onOp={answer} onAskBack={askBackFn} autoFocus={target === "answer"} includeResolved={false} />
          </> : null}
          {view && questions.length === 0 && !saved ? <p>No open questions remain. Waiting for the task status to refresh.</p> : null}
          {card.notePath ? <p className={styles.questionNoteLink}><Link href={`${notesPageHref(card.notePath)}#task-note-questions`}>Answer in the plan note <ExternalLink size={11} aria-hidden /></Link></p> : null}
          {conversationId ? <p className={styles.questionNoteLink}><Link href={agentChatHrefForRun(conversationId)}>Ask the agent in chat first <ExternalLink size={11} aria-hidden /></Link></p> : null}
        </> : action?.label === "Open review" && !reviewPath ? <button type="button" className="btn btn-primary" onClick={() => {
          setChoice({ target, section: "evidence" });
          rootRef.current?.querySelector<HTMLElement>('[data-task-section="evidence"] > summary')?.focus();
        }}>Open review</button>
        : mainAction ? <WorkActionButton action={mainAction} pending={pending} onAction={(next) => void act(next)} /> : review ? null : <p>No action is waiting for you.</p>}
      {reviewPath ? (noCodeReview
        // A report or investigation has no diff to review: the result is the summary above, so the review stays one click away.
        ? <details className={styles.resolved}><summary>Review of the report (no code changed)</summary><div className={styles.reviewNote}><VaultEditorPage vault="notes" path={reviewPath.split("/")} embedded hideTaskQuestions /></div></details>
        : <div className={styles.reviewNote}><VaultEditorPage vault="notes" path={reviewPath.split("/")} embedded hideTaskQuestions /></div>) : null}
      {card.status === "ready-for-review" || action?.kind === "review" || action?.label === "Open review" ? <button type="button" className="btn btn-ghost" onClick={() => void copyTextAndToast(buildTaskReviewMessage(card), "Slack message", toast)}>Copy Slack message</button> : null}
      {saved ? <p role="status" aria-live="polite">{savedMessage}</p> : null}
      {action?.kind === "auto-retry" ? <p>{card.auto?.waiting?.kind === "cap" ? `One more fix round for the remaining findings (${card.counts.blockerBugs} blockers).` : "Retry runs this step on a higher tier, capped at Heavy."} {lastAutoRun?.tier ? `Last run: ${lastAutoRun.tier} tier.` : ""}{retryBaseline ? ` Saved baseline: ${TIER_LABEL[retryBaseline.tier]} · ${describeTierChoice(retryBaseline)}.` : ""} The orchestrator confirms the model at dispatch; no extra cost estimate is available yet.</p> : null}
      {failure ? <p role="alert" className="tone-panel tone-panel--danger">{failure}</p> : null}
    </section>
    {workflow.error ? <FetchError bare message="Couldn't refresh workflow evidence. Last-known details may be out of date." onRetry={() => void workflow.mutate()} /> : null}
    {orchestrations.error || orchestrations.data?.errors.length ? <FetchError bare message="Couldn't confirm auto progress. Last-known state is shown." onRetry={() => void orchestrations.mutate()} /> : null}
    {note.error && action?.kind !== "answer" ? <FetchError bare message="Couldn't refresh the note sections." onRetry={() => void note.mutate()} /> : null}
    <TaskCost card={card} />
    {section("plan", "Plan and decisions", <TaskPlan card={card} view={view} onOpenNote={() => select("note")} />)}
    {section("evidence", "Checks, review and QA evidence", !workflow.data && !workflow.error ? <SkeletonRows count={3} height={40} /> : <TaskEvidence profile={profileId} onRefresh={onRefresh} reviewNotesShown={!!review} card={card} summary={summary} data={workflow.data} view={view} unavailable={!!workflow.error} />)}
    {section("activity", "Conversation and activity", <TaskActivity card={card} summary={summary} data={workflow.data} />)}
    {section("controls", "Links, tiers and manual controls", <TaskControls profile={profileId} card={card} summary={summary} pending={pending} onRefresh={onRefresh} />)}
    {section("note", "Open note", card.notePath ? <VaultEditorPage vault="notes" path={card.notePath.split("/")} embedded hideTaskQuestions /> : <p>No note yet. Starting on auto creates the task’s plan; opening this panel doesn’t create or start anything.</p>)}
    {card.notePath ? <Link className={styles.openFull} href={notesPageHref(card.notePath)}>Open in Notes <ExternalLink size={11} aria-hidden /></Link> : null}
  </div>;
}
