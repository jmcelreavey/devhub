"use client";

import { useState, type ReactNode } from "react";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { mutate } from "swr";
import { setTaskText } from "@/app/storyboard/board-actions";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { WorkCard } from "@/components/storyboard/WorkCard";
import { useTaskAgentActions } from "@/components/tasks/useTaskAgentActions";
import { useWorkAction } from "@/components/storyboard/useWorkAction";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { homeNeedsAction, sortHomeTaskRows, type HomeSections, type TaskWork } from "@/lib/storyboard/home-summary";
import { sectionForTaskAction } from "@/lib/storyboard/task-detail";
import { resolveWorkPresentation } from "@/lib/storyboard/work-summary";
import type { NextAction } from "@/lib/storyboard/next-action";
import { runTaskAction, useTaskActionPending } from "@/lib/storyboard/task-action";
import { compareCards, type BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import { HomePreviewToggle } from "./HomePreviewToggle";
import { HomeTaskCardMenu } from "./HomeTaskCardMenu";
import { useHomeTaskActions } from "./useHomeTaskActions";
import styles from "./HomeWorkSummary.module.css";

function rowStatus(work: TaskWork, running: boolean): string {
  const { presentation, card } = work;
  if (card.finishedFeedback) return `New feedback · ${card.finishedFeedback.summary}`;
  if (presentation.action?.label === "Open review") return `Review ready · ${presentation.status}`;
  if (["retry", "auto-retry"].includes(presentation.action?.kind ?? "")) return `Failed · ${presentation.status}`;
  if (presentation.needsYou && presentation.status !== "Plan ready") return `Needs you · ${presentation.status}`;
  if (running) return `Running · ${presentation.status}`;
  if (presentation.action?.kind === "start-auto") return "Next";
  return presentation.status;
}

/** Stage, Auto switch and agent-run chips read faster than a status sentence, so Home uses the same ones as the task list. */
export function HomeTaskRow(props: { work: TaskWork; profile?: string; onRefresh: () => void; workflowReady: boolean }) {
  const { card } = props.work;
  const task = card.task;
  return task && !isTaskOwnershipBlocked(task) && !card.finishedFeedback ? <HomeTaskRowWithChips {...props} task={task} /> : <HomeTaskRowBody {...props} />;
}

function HomeTaskRowWithChips({ task, ...props }: { work: TaskWork; profile?: string; onRefresh: () => void; workflowReady: boolean; task: NonNullable<BoardCard["task"]> }) {
  const { card } = props.work;
  const open = !(card.taskDone || task.done || task.abandonedAt || task.endDate);
  // Chips only: completion and closing stay with Home's own controls, so these callbacks are never reached.
  const agent = useTaskAgentActions({ task, date: card.date, repoName: card.repo, enabled: open, onComplete: () => undefined, onAbandon: () => undefined });
  // Recovery and decisions need their reason on the row; a run chip alone can look healthy.
  const needsReason = ["retry", "auto-retry", "clear", "answer", "choose-repo", "review-proposal"].includes(props.work.presentation.action?.kind ?? "");
  return <><HomeTaskRowBody {...props} pills={needsReason ? undefined : agent.chip ?? undefined} />{agent.dialogs}</>;
}

function HomeTaskRowBody({ work, profile, onRefresh, workflowReady, pills }: { work: TaskWork; profile?: string; onRefresh: () => void; workflowReady: boolean; pills?: ReactNode }) {
  const { card } = work;
  const detail = useTaskDetail();
  const actions = useHomeTaskActions(card, profile);
  const perform = useWorkAction(profile);
  const pending = useTaskActionPending(card.taskId, profile);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.title);
  const [error, setError] = useState("");
  const section = sectionForTaskAction(work.presentation.action);
  const save = async (value: string) => {
    if (pending || !value.trim()) return;
    setError("");
    const result = await runTaskAction(card.taskId, "home-edit", () => setTaskText(card.taskId, value.trim(), card.date, profile), profile);
    if (result.ok) setEditing(false);
    else setError(result.error ?? "Couldn't update the task.");
    await mutate((key) => typeof key === "string" && ["/api/storyboard", "/api/tasks", "/api/sidebar/counts"].some((prefix) => key.startsWith(prefix)));
  };
  const act = async (action: NextAction) => {
    setError("");
    const result = await perform(card, action);
    if (!result.ok) setError(result.error ?? "Couldn't confirm the update. Refresh before retrying.");
    onRefresh();
  };
  const closed = !!(card.taskDone || card.task?.done || card.task?.abandonedAt || card.task?.endDate);
  const action = work.presentation.action;
  const presentation = !workflowReady ? { status: "Workflow unavailable", needsYou: false, action: null }
    : { ...work.presentation, action: ["finish", "done"].includes(action?.kind ?? "") || (pills && action?.kind === "progress" && !work.presentation.needsYou) ? null : action };
  return <div>
    <WorkCard compact home profile={profile} card={card} pills={workflowReady ? pills : undefined} presentation={presentation} pending={pending}
      onAction={(action) => void act(action)} onOpen={() => detail?.openTask(card.taskId, section)} detailHref={detail?.hrefForTask(card.taskId, section)}
      taskControls={<>{actions.controls}{closed && !work.presentation.action ? <button className="btn btn-ghost" disabled={pending} onClick={() => void actions.reopen(card.prState === "merged" ? "follow-up" : "reopen")}>{card.prState === "merged" ? "Create follow-up task" : "Reopen"}</button> : null}</>}
      titleEditor={editing ? <form className={styles.taskEdit} onSubmit={(event) => { event.preventDefault(); void save(text); }}>
        <input className="input" aria-label="Task title" value={text} maxLength={500} disabled={pending} autoFocus onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }} />
        <button className="btn btn-ghost" disabled={pending || !text.trim()}>Save</button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
      </form> : undefined}
      renderTaskMenu={(props) => <HomeTaskCardMenu {...props} card={card} profile={profile} onStartEdit={() => { setText(card.task?.text ?? card.title); setError(""); setEditing(true); }} onEdit={(value) => void save(value)} />} />
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
  </div>;
}

export function HomeTasks({ cards, summary, items, now, profile, limit, known, workflowReady, expanded, onExpand, finished, onFinished, loading, onRefresh }: {
  cards: BoardCard[]; summary: HomeSections; items: WorkflowInboxItem[]; now: number; profile?: string; limit: number; known: boolean; workflowReady: boolean;
  expanded: boolean; onExpand: () => void; finished: boolean; onFinished: (value: boolean) => void; loading: boolean; onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const needsAction = homeNeedsAction(summary);
  const attentionIds = new Set(needsAction.map(({ card }) => card.taskId));
  const runningIds = new Set(summary.running.map(({ card }) => card.taskId));
  const projected = new Map([...needsAction, ...summary.running, ...summary.next].map((work) => [work.card.taskId, work]));
  const workflows = new Map(items.filter((item) => item.task.id === item.workflow.taskId).map((item) => [item.task.id, item.workflow]));
  const ranked = [...cards].sort((left, right) => compareCards({ ...left, rank: left.rank ?? left.task?.rank }, { ...right, rank: right.rank ?? right.task?.rank }));
  const unique = new Map<string, TaskWork>();
  // Attention is never capped or hidden by the Finished filter: it must match the nav badge.
  for (const work of needsAction) unique.set(work.card.taskId, work);
  for (const card of ranked) {
    if (unique.has(card.taskId)) continue;
    const closed = !!(card.taskDone || card.task?.done || card.task?.abandonedAt || card.task?.endDate);
    if (closed !== (expanded && finished)) continue;
    unique.set(card.taskId, projected.get(card.taskId) ?? { kind: "task", card, presentation: resolveWorkPresentation(card, workflows.get(card.taskId), now) });
  }
  const nextIds = new Set(summary.next.map(({ card }) => card.taskId));
  const filtered = [...unique.values()].filter(({ card }) => !expanded || !search.trim() || attentionIds.has(card.taskId) || card.title.toLowerCase().includes(search.trim().toLowerCase()));
  const rows = sortHomeTaskRows(filtered, attentionIds, runningIds, nextIds);
  const previewLimit = Math.max(1, limit, needsAction.length);
  return <section className={styles.tasks} aria-labelledby="home-tasks-heading">
    <div className={styles.sectionHead}><h2 id="home-tasks-heading">My tasks</h2><span className={styles.taskCount} aria-label={known ? `${needsAction.length} tasks need action` : "Task attention total unavailable"}>{known ? `${needsAction.length} need action` : "—"}</span></div>
    {expanded ? <div className={styles.taskFilters}><div className={styles.prTabs}><button aria-pressed={!finished} onClick={() => onFinished(false)}>All open</button><button aria-pressed={finished} onClick={() => onFinished(true)}>Finished</button></div><input className="input" type="search" aria-label="Search my tasks" placeholder="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} />{needsAction.length ? <small className={styles.taskCount}>Tasks needing you stay at the top</small> : null}</div> : null}
    {loading && !cards.length ? <div aria-busy="true" aria-label="Loading my tasks"><SkeletonRows count={3} variant="list" /></div> : <div id="home-my-tasks" className={styles.list}>{rows.slice(0, expanded ? undefined : previewLimit).map((work) => <HomeTaskRow key={work.card.taskId} work={{ ...work, presentation: { ...work.presentation, status: rowStatus(work, runningIds.has(work.card.taskId)) } }} profile={profile} onRefresh={onRefresh} workflowReady={workflowReady} />)}</div>}
    {!loading && known && !rows.length ? <p className={styles.empty}>{search ? "No matching tasks." : finished ? "No finished tasks." : "No open tasks."}</p> : null}
    <HomePreviewToggle total={rows.length} limit={previewLimit} expanded={expanded} onToggle={onExpand} controls="home-my-tasks" label="Show all tasks" />
  </section>;
}
