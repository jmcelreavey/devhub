"use client";

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { useHistory, usePathname, useSearchParams } from "@/lib/navigation";
import { ImplementTaskDialog } from "@/components/tasks/ImplementTaskDialog";
import { registerStartOnAutoHandler } from "@/lib/storyboard/start-on-auto-request";
import type { BoardCard } from "../../../../packages/shared/ui-lib/storyboard/notes-board-shared";
import { usePanelVisible } from "@/lib/hooks/panel-visibility";
import type { NotesBoard } from "../../../../packages/shared/ui-lib/storyboard/notes-board-shared";
import { taskDetailHref, taskDetailSection, type TaskDetailSection } from "../../../../packages/shared/ui-lib/storyboard/task-detail";
import type { TaskWorkflow } from "../../../../packages/shared/ui-lib/workflows/types";
import type { GithubPrRow } from "@shared/github/pr-types";
import { useProfileWork } from "@/lib/storyboard/use-profile-work";
import { prDetailHref, prDetailIdentity } from "@/lib/storyboard/pr-detail";

const TaskDetailPanel = lazy(() => import("./TaskDetailPanel").then((module) => ({ default: module.TaskDetailPanel })));
const PeerPrDetailPanel = lazy(() => import("./PeerPrDetailPanel").then((module) => ({ default: module.PeerPrDetailPanel })));

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
  const mounted = useClientMounted();
  const history = useHistory();
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
      history.replace(href, { devhubTaskDetail: history.getState()?.devhubTaskDetail });
      return;
    }
    history.push(href, { devhubTaskDetail: { taskId: id, pathname: current.pathname } });
  }, [history, profileId]);

  const openPr = useCallback((pr: GithubPrRow) => {
    const current = new URL(window.location.href);
    const href = prDetailHref(current.pathname, current.search, pr, profileId, current.hash);
    if (current.searchParams.get("pr") === prDetailIdentity(new URL(href, current.origin).searchParams.get("pr"))) history.replace(href, history.getState());
    else history.push(href, { devhubTaskDetail: { prId: prDetailIdentity(new URL(href, current.origin).searchParams.get("pr")), pathname: current.pathname } });
  }, [history, profileId]);

  const closeTask = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const current = new URL(window.location.href);
    const entry = history.getState()?.devhubTaskDetail as { taskId?: string; prId?: string; pathname?: string } | undefined;
    if ((entry?.taskId === current.searchParams.get("task") || entry?.prId === current.searchParams.get("pr")) && entry?.pathname === current.pathname) {
      window.history.back();
    } else {
      current.searchParams.delete("task");
      current.searchParams.delete("taskSection");
      current.searchParams.delete("pr");
      current.searchParams.delete("taskProfile");
      history.replace(`${current.pathname}${current.search}${current.hash}`, null);
    }
    void board.mutate();
    void inbox.mutate();
  }, [board, history, inbox]);

  const context = useMemo(() => ({ board: board.data, workflows, openTask, hrefForTask, openPr, hrefForPr, profileId }), [board.data, workflows, openTask, hrefForTask, openPr, hrefForPr, profileId]);
  return <TaskDetailContext.Provider value={context}>
    {children}
    {launching?.task ? <ImplementTaskDialog open autoByDefault task={launching.task} date={launching.date} repoName={launching.repo} onClose={() => { setLaunching(null); void board.mutate(); void inbox.mutate(); }} /> : null}
    {mounted && <Suspense fallback={null}>{taskId ? <TaskDetailPanel key={taskId} taskId={taskId} board={board.data} boardError={board.error} workflow={workflows.get(taskId)} requestedProfile={params.get("taskProfile") ?? params.get("profile") ?? undefined} requestedSection={taskDetailSection(params.get("taskSection"))} onClose={closeTask} onRefresh={() => { void board.mutate(); void inbox.mutate(); }} /> : prId ? <PeerPrDetailPanel key={prId} identity={prId} requestedProfile={params.get("taskProfile") ?? params.get("profile") ?? undefined} onClose={closeTask} /> : null}</Suspense>}
  </TaskDetailContext.Provider>;
}
