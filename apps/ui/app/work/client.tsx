"use client";

import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "@/lib/navigation";
import { useHistory, useSearchParams } from "@/lib/navigation";
import { CalendarDays, Columns3, Dumbbell, GitPullRequest, History, ListTodo, Ticket } from "lucide-react";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskDetailProvider } from "@/components/storyboard/TaskDetailProvider";
import { PageHeader } from "@/components/shell/PageHeader";
import { InlineSearch } from "@/components/ui/InlineSearch";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import type { SetupGateStatus } from "../../../../packages/shared/ui-lib/navigation/nav";
import { isTaskOpen, type Task } from "@shared/tasks/types";
import type { TaskProfileOverview } from "@shared/tasks/profile-types";
import { profileKey } from "@shared/tasks/profile-scope";
import { matchesTaskSearch } from "../../../../packages/shared/ui-lib/tasks/task-text";
import { jiraBrowseUrl } from "@/lib/utils";
import { openInBrowser } from "@/lib/desktop/bridge";
import { resolveWorkTab, validWorkDate, type WorkTab } from "@/lib/storyboard/work-target";
import storyboardStyles from "@/app/storyboard/storyboard.module.css";
import styles from "./Work.module.css";

function WorkLoading() {
  return <div role="status" aria-label="Loading work"><SkeletonRows count={4} height={52} variant="list" /></div>;
}

const StoryboardBoard = lazy(() => import("@/app/storyboard/client").then((module) => ({ default: module.StoryboardBoard })));
const WorkReviews = lazy(() => import("./WorkReviews"));
const TicketsPage = lazy(() => import("@/components/jira/TicketsPage"));
const TaskHistoryPage = lazy(() => import("@/components/tasks/TaskHistoryPage"));
const WeeklyReviewPage = lazy(() => import("@/app/review/client"));
const RepPage = lazy(() => import("@/app/review/rep/client"));

interface LinkedTicket {
  key: string;
  summary: string;
  status: { name: string };
  issuetype?: string;
}

async function fetchLinkedTicket(url: string): Promise<LinkedTicket | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Jira returned ${response.status}`);
  return response.json() as Promise<LinkedTicket>;
}

function LinkedTicketView({ ticketKey, onClear }: { ticketKey: string; onClear: () => void }) {
  const valid = ticketKey.length <= 100 && /^[A-Z][A-Z0-9]+-\d+$/.test(ticketKey);
  const { data, error, mutate } = useLive<LinkedTicket | null>(
    valid ? `/api/jira/ticket/${encodeURIComponent(ticketKey)}` : null,
    { refreshInterval: 0, fetcher: fetchLinkedTicket, keepPreviousData: false },
  );

  return (
    <div className={styles.embedded}>
      <div className="page-header">
        <h2 className="page-title">Linked Jira ticket</h2>
        <button type="button" className="btn btn-ghost" onClick={onClear}>View assigned tickets</button>
      </div>
      {!valid ? <p role="alert">This Jira ticket link is invalid.</p>
        : error ? <FetchError message="Couldn't load this Jira ticket." onRetry={() => void mutate()} />
        : data === undefined ? <WorkLoading />
        : data === null ? <p role="status">This Jira ticket couldn’t be found or is unavailable.</p>
        : <div className="card card-body space-y-2">
          <a href={jiraBrowseUrl(data.key)} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer" onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void openInBrowser(jiraBrowseUrl(data.key));
          }}>{data.key}</a>
          <p>{data.summary}</p>
          <p className="text-sm text-text-muted">{data.issuetype ? `${data.issuetype} · ` : ""}{data.status.name}</p>
        </div>}
    </div>
  );
}

const WORK_TABS = [
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "board", label: "Board", icon: Columns3 },
  { id: "reviews", label: "PR reviews", icon: GitPullRequest },
  { id: "jira", label: "Jira", icon: Ticket },
  { id: "history", label: "History", icon: History },
  { id: "review", label: "Weekly review", icon: CalendarDays },
  { id: "rep", label: "Daily rep", icon: Dumbbell },
] as const;

export default function WorkPage({ initialTab = "tasks" }: { initialTab?: WorkTab } = {}) {
  const searchParams = useSearchParams();
  const history = useHistory();
  const date = searchParams.get("date");
  const ticket = searchParams.get("ticket");
  const requestedProfile = searchParams.get("taskProfile") ?? searchParams.get("profile");
  const tab = resolveWorkTab(searchParams, initialTab);
  const pipelineView = tab !== "review" && tab !== "rep" && tab !== "reviews";
  // Pills deep-link here: ?q=text, or ?tag=x for tasks tagged #x.
  const urlQuery = searchParams.get("q") ?? (searchParams.get("tag") ? `#${searchParams.get("tag")}` : "");
  const [search, setSearch] = useState({ source: urlQuery, value: urlQuery });
  const taskQuery = search.source === urlQuery ? search.value : urlQuery;
  const tabsRef = useRef<HTMLDivElement>(null);
  const profileRequired = requestedProfile !== null && (tab === "history" || searchParams.has("task"));
  const profile = useLive<TaskProfileOverview>(profileRequired ? "/api/tasks/profiles" : null, { refreshInterval: 0, keepPreviousData: false });
  const activeProfile = profile.data ? profile.data.active ?? "legacy" : undefined;
  const profileMismatch = profileRequired && activeProfile !== undefined && requestedProfile !== activeProfile;
  const profileReady = !profileRequired || (!!profile.data && !profile.error && !profileMismatch);
  const scopedProfile = profileRequired ? requestedProfile ?? undefined : undefined;
  const { data: setup, error: setupError, mutate: refreshSetup } = useLive<SetupGateStatus>("/api/setup/status", { refreshInterval: 0 });
  const taskUrl = profileRequired ? profileKey("/api/tasks", scopedProfile) : "/api/tasks";
  const { data: taskData, error: taskError, mutate: refreshTasks } = useLive<{ tasks?: Task[] }>(pipelineView && profileReady && tab !== "history" ? taskUrl : null, { keepPreviousData: false });
  // Only needed while searching a #tag: tags that live in task notes.
  const noteTagsUrl = profileRequired ? profileKey("/api/tasks/note-tags", scopedProfile) : "/api/tasks/note-tags";
  const { data: noteTagData } = useLive<{ tags: Record<string, string[]> }>(profileReady && tab === "tasks" && taskQuery.includes("#") ? noteTagsUrl : null, { refreshInterval: 0, keepPreviousData: false });
  const noteTags = noteTagData?.tags;
  const taskLoading = taskData === undefined && !taskError;
  const tasks = taskData?.tasks ?? [];
  const open = tasks.filter(isTaskOpen).length;
  // The Jira tab's own list loads it too (same key), so this adds no request while that tab is open.
  const { data: jiraData, error: jiraError } = useLive<{ configured?: boolean; tickets?: unknown[] }>(pipelineView && setup?.jira ? "/api/jira/tickets" : null, { /* Jira tickets change independently. */ refreshInterval: 60_000 });
  const jiraCount = jiraData?.configured && !jiraError ? jiraData.tickets?.length : undefined;
  const visibleTabs = WORK_TABS.filter((item) => item.id !== "jira" || setup?.jira || tab === "jira");
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  const hasSearchMatches = tasks.some((task) =>
    (isTaskOpen(task) || task.done || task.abandonedAt) && matchesTaskSearch(task, taskQuery, noteTags),
  );

  function changeTab(next: WorkTab) {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (next !== "history") params.delete("date");
    if (next !== "jira") params.delete("ticket");
    history.push(`?${params.toString()}${window.location.hash}`, null);
  }

  function clearTarget(key: "date" | "ticket") {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    params.set("tab", key === "date" ? "history" : "jira");
    history.push(`?${params.toString()}${window.location.hash}`, null);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % visibleTabs.length
      : event.key === "ArrowLeft" ? (index + visibleTabs.length - 1) % visibleTabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? visibleTabs.length - 1
      : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = visibleTabs[nextIndex];
    changeTab(next.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#work-tab-${next.id}`)?.focus();
  }

  return (
    <div className={tab === "board" ? "page-wrapper " + storyboardStyles.page : "page-wrapper"}>
      <PageHeader title="Work" subtitle="Tasks, branches, agents and pull requests in one place." />
      <div ref={tabsRef} className={styles.tabs} role="tablist" aria-label="Work views">
        {visibleTabs.map(({ id, label, icon: Icon }, index) => (
          <button key={id} id={`work-tab-${id}`} type="button" role="tab"
            aria-selected={tab === id} aria-controls={`work-panel-${id}`}
            tabIndex={tab === id ? 0 : -1} className={styles.tab}
            onClick={() => changeTab(id)} onKeyDown={(event) => onTabKeyDown(event, index)}>
            <Icon size={15} aria-hidden />
            {label}
            {id === "tasks" && taskData && !taskError && <span className={styles.count} aria-label={`${open} open tasks`}>{open}</span>}
            {id === "jira" && jiraCount !== undefined && <span className={styles.count} aria-label={`${jiraCount} Jira tickets`}>{jiraCount}</span>}
          </button>
        ))}
      </div>
      <p className={styles.tabHint}>Swipe to see all views ↔</p>
      {pipelineView && tab !== "board" && setupError && <FetchError message="Couldn't check the Jira connection." onRetry={() => void refreshSetup()} bare />}
      {visibleTabs.filter((item) => item.id !== tab).map((item) => (
        <div key={item.id} id={`work-panel-${item.id}`} role="tabpanel" aria-labelledby={`work-tab-${item.id}`} hidden />
      ))}
      <div id={`work-panel-${tab}`} role="tabpanel" aria-labelledby={`work-tab-${tab}`} tabIndex={0} className={styles.panel}>
        <Suspense fallback={<WorkLoading />}>
        {tab === "review" ? <WeeklyReviewPage embedded /> : tab === "rep" ? <RepPage embedded /> : tab === "reviews" ? <WorkReviews /> : !profileReady ? (
          profile.error ? <FetchError message="Couldn't confirm the active task profile." onRetry={() => void profile.mutate()} />
            : profileMismatch ? <p role="alert" className="tone-panel tone-panel--warning">This link belongs to task profile {requestedProfile}; the active profile is {activeProfile}. Switch profiles to open it.</p>
            : <WorkLoading />
        ) : (
          <TaskDetailProvider>
            {tab === "tasks" ? (
              <section className={styles.queue} aria-label="Today's queue" aria-busy={taskLoading}>
                <div className={styles.queueHeader}>
                  <div>
                    <h2>Today’s tasks</h2>
                    <p>Capture what needs doing and keep the next step in view.</p>
                  </div>
                  <span className={styles.total} role="status">
                    {taskLoading ? "Loading tasks…" : taskError ? taskData ? "Last loaded list" : "Tasks unavailable" : `${open} open`}
                  </span>
                </div>
                <InlineSearch id="work-task-search" label="Search tasks"
                  placeholder="Search text, Jira key, due date or link…"
                  value={taskQuery} onChange={(value) => setSearch({ source: urlQuery, value })} />
                {taskError && <FetchError message={taskData ? "Couldn't refresh tasks. Showing the last loaded list." : "Couldn't load tasks."}
                  onRetry={() => void refreshTasks()} bare />}
                {taskLoading ? <WorkLoading /> : taskData ? (
                  <>
                    {taskQuery.trim() && !hasSearchMatches && (
                      <p className={styles.empty} role="status">No tasks match “{taskQuery}”. Clear the search or try another term.</p>
                    )}
                    <TaskList searchQuery={taskQuery} noteTags={noteTags} showDetailsButton />
                  </>
                ) : null}
              </section>
            ) : tab === "board" ? <StoryboardBoard embedded /> : tab === "jira" ? (
              setup?.jira ? ticket !== null ? <LinkedTicketView ticketKey={ticket} onClear={() => clearTarget("ticket")} />
                : <div className={styles.embedded}><TicketsPage embedded boardIntake={false} /></div>
                : setup === undefined && !setupError ? <WorkLoading />
                : !setupError ? <p className={styles.empty}>Connect Jira in <Link href="/setup" className="text-accent hover:underline">Setup</Link> to see your tickets.</p> : null
            ) : <div className={styles.embedded}>
              {date !== null && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-text-muted">{validWorkDate(date) ? `Tasks from ${date}` : "This task date is invalid."}</p>
                <button type="button" className="btn btn-ghost" onClick={() => clearTarget("date")}>View all history</button>
              </div>}
              {(date === null || validWorkDate(date)) && <TaskHistoryPage embedded date={date ?? undefined} profile={scopedProfile} />}
            </div>}
          </TaskDetailProvider>
        )}
        </Suspense>
      </div>
    </div>
  );
}
