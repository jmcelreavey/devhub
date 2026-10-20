"use client";

import { useState } from "react";
import type { HomeWork, TaskWork } from "@/lib/storyboard/home-summary";
import { type NextAction } from "@/lib/storyboard/next-action";
import { sectionForTaskAction } from "@/lib/storyboard/task-detail";
import { useTaskActionPending } from "@/lib/storyboard/task-action";
import { useTaskDetail } from "./TaskDetailProvider";
import { useWorkAction } from "./useWorkAction";
import { WorkCard } from "./WorkCard";
import { useHomeTaskActions } from "@/components/home/useHomeTaskActions";
import { HomeTaskCardMenu } from "@/components/home/HomeTaskCardMenu";

function TaskSummaryCard({ work, profile, onRefresh, home = false }: { work: TaskWork; profile?: string; onRefresh: () => void; home?: boolean }) {
  const detail = useTaskDetail();
  const pending = useTaskActionPending(work.card.taskId, profile);
  const perform = useWorkAction(profile);
  const homeActions = useHomeTaskActions(work.card, profile);
  const [failure, setFailure] = useState("");
  const section = sectionForTaskAction(work.presentation.action);
  const act = async (action: NextAction) => {
    setFailure("");
    const result = await perform(work.card, action);
    if (!result.ok) setFailure(result.error ?? "Couldn't confirm the update. Refresh before retrying.");
    onRefresh();
  };
  return <div>
    <WorkCard compact home={home} profile={profile} card={work.card} presentation={home && ["finish", "done"].includes(work.presentation.action?.kind ?? "") ? { ...work.presentation, action: null } : work.presentation} pending={pending} onAction={(action) => void act(action)} onOpen={() => detail?.openTask(work.card.taskId, section)} detailHref={detail?.hrefForTask(work.card.taskId, section)} taskControls={home ? homeActions.controls : undefined} renderTaskMenu={home ? (props) => <HomeTaskCardMenu {...props} card={work.card} profile={profile} /> : undefined} />
    {failure ? <p role="alert" className="text-xs text-danger pb-3">{failure}</p> : null}
  </div>;
}

export function WorkSummaryCard({ work, profile, onRefresh, home = false }: { work: HomeWork; profile?: string; onRefresh: () => void; home?: boolean }) {
  const detail = useTaskDetail();
  if (work.kind === "task") return <TaskSummaryCard work={work} profile={profile} onRefresh={onRefresh} home={home} />;
  return <WorkCard compact pr={work.pr} presentation={work.presentation} onAction={() => detail?.openPr(work.pr)} onOpen={() => detail?.openPr(work.pr)} detailHref={detail?.hrefForPr(work.pr)} />;
}
