"use client";

import { mutate } from "swr";
import { useMemo, useState } from "react";
import { StoryboardCapture } from "@/components/storyboard/StoryboardCapture";
import { TaskDetailProvider } from "@/components/storyboard/TaskDetailProvider";
import { FetchError } from "@/components/ui/FetchError";
import { useProfileWork } from "@/lib/storyboard/use-profile-work";
import { homeWorkSummary } from "@/lib/storyboard/home-summary";
import { useMinuteTick } from "@/lib/tickers";
import { RefreshUpdated } from "@/components/storyboard/RefreshUpdated";
import { WorkCost } from "@/components/storyboard/WorkCost";
import { HomeTasks } from "./HomeTasks";
import { useStoredChoice } from "@/lib/hooks/use-stored-state";
import { useLive } from "@/lib/hooks/use-fetch";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { HomeContext, HomeDayLinks } from "./HomeDayLinks";
import { LegacyTodayRedirect } from "./LegacyTodayRedirect";
import styles from "./HomeWorkSummary.module.css";

export function HomeWorkSummary({ limit = 3 }: { limit?: number }) {
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  return <HomeWorkSummaryContent key={profile.data?.active ?? "legacy"} limit={limit} />;
}

function HomeWorkSummaryContent({ limit }: { limit: number }) {
  const [finished, setFinished] = useState(false);
  const [captureRevision, setCaptureRevision] = useState(0);
  const { profile, profileId, board, inbox, prs, owned } = useProfileWork({ includePrs: true, allDone: finished });
  const [taskPreview, setTaskPreview] = useStoredChoice(`home-tasks:${profileId}`, "collapsed", ["collapsed", "expanded"] as const);
  const now = useMinuteTick();
  const tasksReady = !!board.data && !!inbox.data && !profile.error;
  const taskLoading = !profile.error && (!profile.data || (!board.data && !board.error) || (!inbox.data && !inbox.error));
  const tasksDegraded = !!(board.error || inbox.error || profile.error || board.data?.errors.length);
  const githubDegraded = !!(prs.error || prs.data?.stale || prs.data?.configured === false || owned.error);
  const summary = useMemo(() => homeWorkSummary(tasksReady ? board.data!.cards : [], tasksReady ? inbox.data!.items : [], !profile.error ? prs.data?.reviews ?? [] : [], board.data ? Date.parse(board.data.generatedAt) : 0, !profile.error ? prs.data?.authored : [], owned.data?.repos.map((repo) => repo.fullName), !profile.error ? prs.data?.feedbackPrs : []), [tasksReady, board.data, inbox.data, prs.data, profile.error, owned.data]);
  const refresh = async () => { await Promise.all([board.mutate(), inbox.mutate(), prs.mutate(), owned.mutate(), mutate((key) => typeof key === "string" && ["/api/calendar", "/api/jira/tickets", "/api/repos/worktree-cleanup", "/api/github/prs/owned"].some((url) => key.startsWith(url)))]); };
  const readAt = board.data?.generatedAt;
  const day = now ? new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";
  return <div className={`page-wrapper ${styles.home}`}>
    <header className={styles.intro}>
      <div><p className={styles.date}>{day || <span className="skeleton" style={{ display: "inline-block", width: 160, height: 12 }} />}</p><h1>What needs you</h1></div>
      <div className={styles.meta}><RefreshUpdated at={readAt} onRefresh={refresh} degraded={tasksDegraded} /><WorkCost cost={board.data?.cost} /></div>
    </header>
    <StoryboardCapture id="home-capture" inline empty={tasksReady && !tasksDegraded && board.data!.cards.length === 0} onCaptured={() => { setFinished(false); setTaskPreview("expanded"); setCaptureRevision((revision) => revision + 1); }} />
    <HomeContext now={now} profile={profile.error ? undefined : profileId} unavailable={!!profile.error} />
    {profile.error ? <FetchError bare message="Couldn't confirm the active task profile. Work is hidden until it can be confirmed." onRetry={() => void profile.mutate()} /> : null}
    {tasksDegraded && !profile.error ? <FetchError bare message={`${board.error || board.data?.errors.length ? "Task sources unavailable" : "Workflow unavailable"}${readAt ? ` · showing last-known work from ${new Date(readAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ". Work totals are unavailable."}`} onRetry={() => { if (board.error || board.data?.errors.length) void board.mutate(); if (inbox.error) void inbox.mutate(); }} /> : null}
    {githubDegraded ? <FetchError bare message={owned.error ? "Owned repositories unavailable. Review totals are unavailable." : `GitHub unavailable${prs.data?.generatedAt ? ` · last read ${new Date(prs.data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ". Review totals are unavailable."}`} onRetry={() => { void prs.mutate(); void owned.mutate(); }} /> : null}
    {!profile.error ? <HomeTasks key={`${profileId}:${captureRevision}`} cards={board.data?.cards ?? []} summary={summary} items={inbox.data?.items ?? []} now={board.data ? Date.parse(board.data.generatedAt) : now} profile={profileId} limit={limit} known={tasksReady && !tasksDegraded} workflowReady={tasksReady} expanded={taskPreview === "expanded"} onExpand={() => { setTaskPreview(taskPreview === "expanded" ? "collapsed" : "expanded"); setFinished(false); }} finished={finished} onFinished={setFinished} loading={taskLoading} onRefresh={refresh} /> : null}
    <HomeDayLinks key={`day:${profileId}`} profile={profile.error ? undefined : profileId} unavailable={!!profile.error} prs={profile.error ? undefined : prs.data} githubUnavailable={githubDegraded || !!profile.error} />
  </div>;
}

export function HomePage() {
  return <TaskDetailProvider><LegacyTodayRedirect /><HomeWorkSummary /></TaskDetailProvider>;
}
