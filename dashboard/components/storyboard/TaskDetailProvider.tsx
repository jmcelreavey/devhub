"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { ImplementTaskDialog } from "@/components/tasks/ImplementTaskDialog";
import { registerStartOnAutoHandler } from "@/lib/storyboard/start-on-auto-request";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { usePanelVisible } from "@/lib/hooks/panel-visibility";
import type { NotesBoard } from "@/lib/storyboard/notes-board-shared";
import { taskDetailHref, taskDetailSection, type TaskDetailSection } from "@/lib/storyboard/task-detail";
import type { TaskWorkflow } from "@/lib/workflows/types";
import type { GithubPrRow } from "@/lib/github/prs";
import { useProfileWork } from "@/lib/storyboard/use-profile-work";
import { prDetailHref, prDetailIdentity } from "@/lib/storyboard/pr-detail";

const TaskDetailPanel = dynamic(() => import("./TaskDetailPanel").then((module) => module.TaskDetailPanel), { ssr: false });
const PeerPrDetailPanel = dynamic(() => import("./PeerPrDetailPanel").then((module) => module.PeerPrDetailPanel), { ssr: false });

interface TaskDetailContextValue {
  board?: NotesBoard;
  workflows: Map<string, TaskWorkflow>;
  openTask: (taskId: string, section?: TaskDetailSection) => void;
  hrefForTask: (taskId: string, section?: TaskDetailSection) => string;
  openPr: (pr: GithubPrRow) => void;
  hrefForPr: (pr: GithubPrRow) => string;
  profileId?: string;
}

const TaskDetailContext = createContext<TaskDetailContextValue | null>(null);

export function useTaskDetail() {
  return useContext(TaskDetailContext);
}

export function TaskDetailProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const visible = usePanelVisible();
  const taskId = visible ? params.get("task") : null;
  const prId = visible && !taskId ? prDetailIdentity(params.get("pr")) : null;
  const [launching, setLaunching] = useState<BoardCard | null>(null);
  useEffect(() => registerStartOnAutoHandler(setLaunching), []);
  const closing = useRef(false);
  useEffect(() => { closing.current = false; }, [taskId, prId]);
  const { board, inbox, profileId } = useProfileWork({ allDone: params.get("done") === "all" });
  const workflows = useMemo(() => new Map((inbox.data?.items ?? []).map((item) => [item.task.id, item.workflow])), [inbox.data?.items]);
  const search = params.toString();
  const scopedSearch = useMemo(() => { const next = new URLSearchParams(search); if (profileId) next.set("taskProfile", profileId); return next.toString(); }, [search, profileId]);
  const hrefForTask = useCallback((id: string, section?: TaskDetailSection) => taskDetailHref(pathname, scopedSearch, id, section, typeof window === "undefined" ? "" : window.location.hash), [pathname, scopedSearch]);
  const hrefForPr = useCallback((pr: GithubPrRow) => prDetailHref(pathname, search, pr, profileId, typeof window === "undefined" ? "" : window.location.hash), [pathname, search, profileId]);

  const openTask = useCallback((id: string, section?: TaskDetailSection) => {
    const current = new URL(window.location.href);
    if (profileId) current.searchParams.set("taskProfile", profileId);
    const href = taskDetailHref(current.pathname, current.search, id, section, current.hash);
    if (current.searchParams.get("task") === id) {
      window.history.replaceState({ devhubTaskDetail: window.history.state?.devhubTaskDetail }, "", href);
      return;
    }
    window.history.pushState({ devhubTaskDetail: { taskId: id, pathname: current.pathname } }, "", href);
  }, [profileId]);

  const openPr = useCallback((pr: GithubPrRow) => {
    const current = new URL(window.location.href);
    const href = prDetailHref(current.pathname, current.search, pr, profileId, current.hash);
    if (current.searchParams.get("pr") === prDetailIdentity(new URL(href, current.origin).searchParams.get("pr"))) window.history.replaceState(window.history.state, "", href);
    else window.history.pushState({ devhubTaskDetail: { prId: prDetailIdentity(new URL(href, current.origin).searchParams.get("pr")), pathname: current.pathname } }, "", href);
  }, [profileId]);

  const closeTask = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const current = new URL(window.location.href);
    const entry = window.history.state?.devhubTaskDetail as { taskId?: string; prId?: string; pathname?: string } | undefined;
    if ((entry?.taskId === current.searchParams.get("task") || entry?.prId === current.searchParams.get("pr")) && entry?.pathname === current.pathname) {
      window.history.back();
    } else {
      current.searchParams.delete("task");
      current.searchParams.delete("taskSection");
      current.searchParams.delete("pr");
      current.searchParams.delete("taskProfile");
      window.history.replaceState(null, "", `${current.pathname}${current.search}${current.hash}`);
    }
    void board.mutate();
    void inbox.mutate();
  }, [board, inbox]);

  const context = useMemo(() => ({ board: board.data, workflows, openTask, hrefForTask, openPr, hrefForPr, profileId }), [board.data, workflows, openTask, hrefForTask, openPr, hrefForPr, profileId]);
  return <TaskDetailContext.Provider value={context}>
    {children}
    {launching?.task ? <ImplementTaskDialog open autoByDefault task={launching.task} date={launching.date} repoName={launching.repo} onClose={() => { setLaunching(null); void board.mutate(); void inbox.mutate(); }} /> : null}
    {taskId ? <TaskDetailPanel key={taskId} taskId={taskId} board={board.data} boardError={board.error} workflow={workflows.get(taskId)} requestedProfile={params.get("taskProfile") ?? params.get("profile") ?? undefined} requestedSection={taskDetailSection(params.get("taskSection"))} onClose={closeTask} onRefresh={() => { void board.mutate(); void inbox.mutate(); }} /> : prId ? <PeerPrDetailPanel key={prId} identity={prId} requestedProfile={params.get("taskProfile") ?? params.get("profile") ?? undefined} onClose={closeTask} /> : null}
  </TaskDetailContext.Provider>;
}
