"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link, { useHistory, useSearchParams } from "@/lib/navigation";
import { mutate as globalMutate } from "swr";
import { AlertTriangle, ChevronDown, ChevronRight, NotebookPen, RefreshCw } from "lucide-react";
import { FetchError, SkeletonRows } from "@/components";
import { HomeTaskRow } from "@/components/tasks/home/HomeTasks";
import type { TaskWork } from "../../../../packages/shared/ui-lib/storyboard/home-summary";
import { useProfileWork } from "@/lib/storyboard/use-profile-work";
import { repoTaskWork } from "@/lib/repos/repo-task-work";
import { CalendarEventRow } from "@/components/calendar/CalendarEventRow";
import { NoteListRow } from "@/components/notes/NoteListRow";
import { PrRow } from "@/components/PrRow";
import { JiraTicketQueueRow } from "@/components/jira/JiraTicketRow";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { HistoryPanel } from "@/components/repo-git/HistoryPanel";
import { HubWorkingTree } from "@/components/repo-git/HubWorkingTree";
import {
  asHubJiraTicket,
  HubRepoNoteButton,
} from "@/components/repo-hub/HubWorkRows";
import { HubSection } from "@/components/repo-hub/HubSection";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import type { EntityRef } from "../../../../packages/shared/ui-lib/entity-note";
import { matchesTaskSearch } from "../../../../packages/shared/ui-lib/tasks/task-text";
import type { GithubPrRow } from "@shared/github/pr-types";
import { useLive } from "@/lib/hooks/use-fetch";
import { useMinuteTick } from "@/lib/tickers";
import { useStoredState } from "@/lib/hooks/use-stored-state";
import type { CalendarEvent } from "@shared/calendar/types";
import {
  capHubList,
  hubCalendarEvents,
  HUB_LONG_LIST_PREVIEW,
  HUB_NOTES_PREVIEW,
  type WorkHubEvent,
  type WorkHubModel,
  type WorkHubNote,
  type WorkHubTask,
} from "../../../../packages/shared/ui-lib/repos/work-hub";
import type { RepoInfo } from "@shared/repos/types";

interface RepoWorkPayload {
  date: string;
  fullName: string | null;
  openPrs?: GithubPrRow[];
  /** Which of `openPrs` are yours — from an `author:@me` search, not a login match. */
  myPrUrls?: string[];
  model: WorkHubModel;
  doneTasks?: WorkHubTask[];
  /** Optional integrations that failed; their rows are missing, not absent. */
  degraded?: { source: string; message: string }[];
}

function matchesWorkSearch(work: TaskWork, query: string): boolean {
  return work.card.task ? matchesTaskSearch(work.card.task, query) : work.card.title.toLowerCase().includes(query.trim().toLowerCase());
}

/** Past this many queued items the backlog starts collapsed. */
const BACKLOG_AUTO_COLLAPSE = 4;

const HUB_TABS = [
  { id: "overview", label: "Overview" },
  { id: "work", label: "Active work" },
  { id: "notes", label: "Notes" },
  { id: "prs", label: "My PRs" },
] as const;

type HubTab = (typeof HUB_TABS)[number]["id"];

function asCalendarEvent(event: WorkHubEvent): CalendarEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end ?? event.start,
    isAllDay: false,
    htmlLink: event.htmlLink,
  };
}

function sortPrsNewest(rows: readonly GithubPrRow[]): GithubPrRow[] {
  return [...rows].sort((a, b) =>
    (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""),
  );
}

function HubCappedList<T>({
  items,
  limit,
  render,
}: {
  items: readonly T[];
  limit: number;
  render: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = capHubList(items, limit, expanded);
  const hidden = items.length - shown.length;
  return (
    <>
      {shown.map(render)}
      {items.length > limit ? (
        <button
          type="button"
          className="repo-hub-show-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Show less" : `Show more (${hidden})`}
        </button>
      ) : null}
    </>
  );
}

export function RepoWorkHub({
  repo,
  onMutate,
}: {
  repo: RepoInfo;
  onMutate: () => void;
}) {
  const searchParams = useSearchParams();
  const history = useHistory();
  const requestedTab = searchParams.get("tab");
  const tab = HUB_TABS.find((item) => item.id === requestedTab)?.id ?? "overview";
  const tabId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const workUrl = `/api/repos/${encodeURIComponent(repo.name)}/work`;
  const work = useLive<RepoWorkPayload>(`${workUrl}?scope=local`);
  const remote = useLive<{ ok: boolean }>(`${workUrl}?scope=external`, { /* GitHub work status changes independently. */ refreshInterval: 20_000 });
  // The work route already searched this repo's PRs, yours included. Re-running
  // that search here, then waiting on the whole authored-PR list (~14s) to tell
  // yours apart, showed "No open PRs of yours" until it landed.
  const { mine, others } = useMemo(() => {
    const myUrls = new Set(work.data?.myPrUrls ?? []);
    const rows = sortPrsNewest(work.data?.openPrs ?? []);
    return {
      mine: rows.filter((row) => myUrls.has(row.url)),
      others: rows.filter((row) => !myUrls.has(row.url)),
    };
  }, [work.data?.openPrs, work.data?.myPrUrls]);
  const [historyOpen, setHistoryOpen] = useStoredState(
    "devhub:repo-hub:history-open",
    false,
    (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
    (value) => (value ? "1" : "0"),
  );
  const [gitOpen, setGitOpen] = useState(false);
  const [gitFocusPath, setGitFocusPath] = useState<string | null>(null);
  // Every task added here belongs to this repo; the composer pins the link.
  const repoLinks = useMemo<EntityRef[]>(
    () => [{ kind: "repo", id: repo.name, label: repo.name }],
    [repo.name],
  );
  const model = work.data?.model;
  const { profile, profileId, board, inbox } = useProfileWork({ allDone: true });
  const now = useMinuteTick();
  const tasksLoading = !profile.error && (!profile.data || (!board.data && !board.error) || (!inbox.data && !inbox.error));
  const tasksError = profile.error || board.error || inbox.error;
  const workflowReady = !!board.data && !!inbox.data && !tasksError;
  const taskWork = useMemo(() => repoTaskWork(
    profile.error ? [] : board.data?.cards ?? [], inbox.data?.items ?? [], repo.name,
    work.data?.fullName ?? repo.remote?.match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1] ?? null,
    now || (board.data ? Date.parse(board.data.generatedAt) : 0),
  ), [profile.error, board.data, inbox.data, repo.name, repo.remote, work.data?.fullName, now]);
  const calendar = useMemo(
    () => (model ? hubCalendarEvents(model) : []),
    [model],
  );
  // `?? []` inline would hand the memos below a fresh array every render.
  const degraded = useMemo(() => work.data?.degraded ?? [], [work.data?.degraded]);
  const otherTickets = useMemo(() => [...(model?.openTickets ?? []), ...(model?.clusters.flatMap((cluster) => cluster.jira && !cluster.tasks.length ? [cluster.jira] : []) ?? [])], [model]);
  const backlogTasks = taskWork.backlog;
  const notes = useMemo(() => [...new Map([...(model?.clusters.flatMap((cluster) => cluster.notes) ?? []), ...(model?.leftoverNotes ?? [])].map((note) => [note.slug, note])).values()].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)), [model]);
  const backlogCount = backlogTasks.length + otherTickets.length;
  const doneTasks = taskWork.done;

  const [backlogOpen, setBacklogOpen] = useStoredState(
    "devhub:repo-hub:backlog-open",
    false,
    (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
    (value) => (value ? "1" : "0"),
  );
  const [doneOpen, setDoneOpen] = useState(false);
  const [otherPrsOpen, setOtherPrsOpen] = useState(false);
  const [backlogQuery, setBacklogQuery] = useState("");
  const [doneQuery, setDoneQuery] = useState("");

  // Small backlogs are cheap to show; only a long queue earns a collapse.
  const backlogExpanded = backlogOpen || backlogCount <= BACKLOG_AUTO_COLLAPSE;

  const shownBacklogTasks = useMemo(
    () => backlogTasks.filter((work) => matchesWorkSearch(work, backlogQuery)),
    [backlogTasks, backlogQuery],
  );
  const shownBacklogTickets = useMemo(() => {
    const q = backlogQuery.trim().toLowerCase();
    if (!q) return otherTickets;
    return otherTickets.filter((ticket) =>
      `${ticket.key} ${ticket.summary} ${ticket.status}`.toLowerCase().includes(q),
    );
  }, [otherTickets, backlogQuery]);
  const shownDone = useMemo(
    () => doneTasks.filter((work) => matchesWorkSearch(work, doneQuery)),
    [doneTasks, doneQuery],
  );

  function changeTab(next: HubTab) {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    history.push(`/repos/${encodeURIComponent(repo.name)}?${params}${window.location.hash}`, history.getState());
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % HUB_TABS.length
      : event.key === "ArrowLeft" ? (index + HUB_TABS.length - 1) % HUB_TABS.length
      : event.key === "Home" ? 0
      : event.key === "End" ? HUB_TABS.length - 1
      : null;
    if (nextIndex === null) return;
    event.preventDefault();
    changeTab(HUB_TABS[nextIndex].id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }

  function refreshTasks() {
    void board.mutate();
    void inbox.mutate();
    void work.mutate();
  }

  function renderTask(task: TaskWork) {
    return <HomeTaskRow key={task.card.taskId} work={task} profile={profileId} workflowReady={workflowReady} onRefresh={refreshTasks} />;
  }

  function openFileInGit(path: string) {
    setGitFocusPath(path);
    setGitOpen(true);
  }

  async function onTaskAdded() {
    // Refresh both task projections after the repo-pinned composer saves.
    void globalMutate("/api/tasks");
    refreshTasks();
  }

  function renderNote(note: WorkHubNote) {
    const linkedTask = model?.clusters.flatMap((cluster) => cluster.tasks).find((task) => task.notePath === note.slug || note.slug.endsWith(`-${task.id}`));
    const title = /^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/i.test(note.title) && linkedTask ? `${linkedTask.text} — notes` : note.title;
    const age =
      note.ts && note.ts > 0 ? new Date(note.ts).toISOString().slice(0, 10) : undefined;
    return (
      <NoteListRow key={note.slug} note={{ ...note, title }} className="repo-hub-row">
        <NotebookPen size={14} className="lib-card-icon" />
        <span className="repo-hub-row-main">
          <span className="repo-hub-row-title break-words">{title}</span>
          {age ? <span className="repo-hub-row-meta">{age}</span> : null}
        </span>
      </NoteListRow>
    );
  }

  function renderEvent(event: WorkHubEvent) {
    return <CalendarEventRow key={event.id} event={asCalendarEvent(event)} density="compact" />;
  }

  return (
    <>
      <div ref={tabsRef} role="tablist" aria-label="Repository views" className="mt-4 flex flex-wrap gap-x-4 border-b border-border">
        {HUB_TABS.map(({ id, label }, index) => {
          const count = id === "work" ? !tasksLoading && !tasksError ? taskWork.active.length : undefined
            : id === "notes" ? work.data && !work.error ? notes.length : undefined
            : id === "prs" ? work.data && !work.error && !degraded.some((entry) => entry.source === "GitHub") ? mine.length : undefined
            : undefined;
          return (
            <button key={id} type="button" role="tab" id={`${tabId}-tab-${id}`}
              aria-controls={`${tabId}-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
              className={`flex min-h-11 items-center gap-2 border-b-2 px-1 text-sm ${tab === id ? "border-accent font-semibold text-text" : "border-transparent text-text-muted hover:text-text"}`}
              onClick={() => changeTab(id)} onKeyDown={(event) => onTabKeyDown(event, index)}>
              {label}
              {count !== undefined && count > 0 ? <span className="repo-hub-section-count">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-4">
        {degraded.length > 0 ? (
          <div className="mb-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={14} className="shrink-0 text-warning" aria-hidden />
              <p className="min-w-0 flex-1 text-sm text-text-muted" role="status">
                {degraded.map((entry) => entry.source).join(" and ")}{" "}
                couldn’t be loaded.
              </p>
              <button type="button" className="btn btn-ghost text-xs"
                disabled={work.isValidating || remote.isValidating} onClick={() => void remote.mutate()}>
                <RefreshCw size={12} aria-hidden />
                {work.isValidating || remote.isValidating ? "Refreshing…" : "Retry"}
              </button>
            </div>
            <details className="mt-2 text-xs text-text-muted">
              <summary className="cursor-pointer">Some linked items may be missing · Details</summary>
              <ul className="mt-2 space-y-2">
                {degraded.map((entry) => (
                  <li key={entry.source} className="break-words">
                    <strong className="text-text">{entry.source}:</strong> {entry.message}{" "}
                    {entry.source === "Calendar" && <Link href="/calendar" className="text-accent hover:underline">Open Calendar</Link>}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
        {work.error ? <FetchError bare message={work.error.message} onRetry={() => void work.mutate()} /> : null}
        {remote.error ? <FetchError bare message={remote.error.message} onRetry={() => void remote.mutate()} /> : null}
      </div>

      {/* Keep each view mounted so switching tabs preserves drafts and open context panels. */}
      <div role="tabpanel" id={`${tabId}-panel-work`} aria-labelledby={`${tabId}-tab-work`} hidden={tab !== "work"} tabIndex={0}>
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">Active work</h2>
          <Link className="text-xs text-text-muted hover:text-accent" href={`/storyboard?repo=${encodeURIComponent(repo.name)}`}>Open Storyboard</Link>
        </div>
        {tasksError ? <FetchError bare message={profile.error ? "Couldn’t confirm the task profile." : "Task status unavailable. Refresh before starting work."} onRetry={() => { void profile.mutate(); refreshTasks(); }} /> : null}
        {tasksLoading ? <SkeletonRows count={3} /> : taskWork.active.length ? (
          <div className="space-y-2">{taskWork.active.map(renderTask)}</div>
        ) : !tasksError ? (
          <p className="text-sm text-text-muted">{backlogTasks.length ? "Nothing running. Start a backlog task on auto when you’re ready." : "No active work. Add a task to start on auto."}</p>
        ) : null}
        <div className="mt-3 space-y-3">
          <TaskComposer
            inputId="repo-hub-task-add"
            placeholder={`Add a task for ${repo.name}… (paste a link or Jira key, @ to link)`}
            baseLinks={repoLinks}
            onAdded={onTaskAdded}
          />
        </div>
      </section>

      {backlogCount > 0 ? (
        <HubSection
          title="Backlog"
          count={backlogCount}
          open={backlogExpanded}
          onOpenChange={setBacklogOpen}
          query={backlogQuery}
          onQueryChange={setBacklogQuery}
          searchPlaceholder="Filter backlog…"
        >
          {shownBacklogTasks.length + shownBacklogTickets.length === 0 ? (
            <p className="text-xs text-text-subtle">Nothing matches “{backlogQuery}”.</p>
          ) : (
            <div className="space-y-2">
              {shownBacklogTasks.map(renderTask)}
              {shownBacklogTickets.map((ticket) => (
                <JiraTicketQueueRow
                  key={ticket.key}
                  ticket={asHubJiraTicket(ticket)}
                  onTransitioned={() => void remote.mutate()}
                />
              ))}
            </div>
          )}
        </HubSection>
      ) : null}

      {doneTasks.length > 0 ? (
        <HubSection
          title="Done"
          count={doneTasks.length}
          open={doneOpen}
          onOpenChange={setDoneOpen}
          query={doneQuery}
          onQueryChange={setDoneQuery}
          searchThreshold={1}
          searchPlaceholder="Search finished work…"
        >
          {shownDone.length === 0 ? (
            <p className="text-xs text-text-subtle">Nothing matches “{doneQuery}”.</p>
          ) : (
            <div className="divide-y divide-border">
              <HubCappedList
                items={shownDone}
                limit={HUB_LONG_LIST_PREVIEW}
                render={renderTask}
              />
            </div>
          )}
        </HubSection>
      ) : null}
      </div>

      <div role="tabpanel" id={`${tabId}-panel-overview`} aria-labelledby={`${tabId}-tab-overview`} hidden={tab !== "overview"} tabIndex={0}>
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="flex min-h-11 items-center gap-1 text-sm font-semibold text-text"
            aria-expanded={historyOpen}
            aria-controls={`${tabId}-commits`}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            {historyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Commits
          </button>
          <RepoGitWorkspace
            repoName={repo.name}
            repoPath={repo.path}
            dirtyCount={repo.dirtyCount}
            unpushedCount={repo.unpushedCount ?? 0}
            onMutate={onMutate}
            open={gitOpen}
            onOpenChange={(next) => {
              setGitOpen(next);
              if (!next) setGitFocusPath(null);
            }}
            initialTab={gitFocusPath ? "changes" : undefined}
            focusPath={gitFocusPath}
            onFocusPathConsumed={() => setGitFocusPath(null)}
          />
        </div>
        <div id={`${tabId}-commits`} className="repo-hub-history repo-git-tab-body" data-collapsed={historyOpen ? undefined : ""}>
          <HistoryPanel
            repoName={repo.name}
            repoPath={repo.path}
            onMutate={onMutate}
            collapsed={!historyOpen}
            defaultScope="current"
          />
        </div>
      </section>

      <section className="mt-5">
        <HubWorkingTree repoName={repo.name} onOpenFile={openFileInGit} />
      </section>
      {calendar.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-text">Calendar</h2>
          <div className="divide-y divide-border">
            <HubCappedList items={calendar} limit={HUB_LONG_LIST_PREVIEW} render={renderEvent} />
          </div>
        </section>
      ) : null}
      </div>

      <div role="tabpanel" id={`${tabId}-panel-prs`} aria-labelledby={`${tabId}-tab-prs`} hidden={tab !== "prs"} tabIndex={0}>
        <section>
          <h2 className="text-sm font-semibold text-text mb-2">My PRs</h2>
          {work.isLoading ? (
            <SkeletonRows count={3} />
          ) : mine.length ? (
            <div className="divide-y divide-border">
              <HubCappedList
                items={mine}
                limit={HUB_LONG_LIST_PREVIEW}
                render={(row) => <PrRow key={row.url} row={row} kind="authored" />}
              />
            </div>
          ) : (
            <p className="text-xs text-text-subtle">{work.error || degraded.some((entry) => entry.source === "GitHub") ? "Pull requests could not be loaded." : "No open PRs of yours."}</p>
          )}
          {others.length > 0 ? (
            <details
              className="repo-hub-other-prs"
              onToggle={(event) => setOtherPrsOpen(event.currentTarget.open)}
            >
              <summary className="flex min-h-11 items-center gap-1">
                {otherPrsOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                Other PRs ({others.length})
              </summary>
              {/* A closed <details> still mounts its children, and every PrRow
                  checks for a review note — ~20 requests per visit for a list
                  nobody had opened, queued ahead of the hub's own data. */}
              {otherPrsOpen ? (
                <div className="divide-y divide-border mt-2">
                  <HubCappedList
                    items={others}
                    limit={HUB_LONG_LIST_PREVIEW}
                    render={(row) => <PrRow key={row.url} row={row} kind="reviewed" />}
                  />
                </div>
              ) : null}
            </details>
          ) : null}
        </section>
      </div>
      <div role="tabpanel" id={`${tabId}-panel-notes`} aria-labelledby={`${tabId}-tab-notes`} hidden={tab !== "notes"} tabIndex={0}>
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">Notes</h2>
            <HubRepoNoteButton repoName={repo.name} repoPath={repo.path} />
          </div>
          {work.isLoading ? (
            <SkeletonRows count={3} />
          ) : notes.length ? (
            <div className="divide-y divide-border">
              <HubCappedList
                items={notes}
                limit={HUB_NOTES_PREVIEW}
                render={renderNote}
              />
            </div>
          ) : (
            <p className="text-xs text-text-subtle">{work.error ? "Notes could not be loaded." : "No notes linked to this repo."}</p>
          )}
        </section>
      </div>
    </>
  );
}
