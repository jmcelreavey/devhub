"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { mutate as globalMutate } from "swr";
import { AlertTriangle, ChevronDown, ChevronRight, NotebookPen, RefreshCw } from "lucide-react";
import { FetchError, SkeletonRows } from "@/components";
import { SharedEntityChips } from "@/components/EntityLinkChips";
import { CalendarEventRow } from "@/components/briefing/CalendarEventRow";
import { NoteListRow } from "@/components/notes/NoteListRow";
import { PrRow } from "@/components/PrRow";
import { JiraTicketQueueRow } from "@/components/jira/JiraTicketRow";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { HistoryPanel } from "@/components/repo-git/HistoryPanel";
import { HubWorkingTree } from "@/components/repo-git/HubWorkingTree";
import { HubWorkCluster } from "@/components/repo-hub/HubWorkCluster";
import {
  asHubJiraTicket,
  asHubTask,
  HubArchiveRow,
  HubRepoNoteButton,
  HubTaskRow,
} from "@/components/repo-hub/HubWorkRows";
import { HubSection } from "@/components/repo-hub/HubSection";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import type { EntityRef } from "@/lib/entity-note";
import { commonTaskRefs } from "@/lib/repos/hub-chips";
import { matchesTaskSearch } from "@/lib/tasks/task-text";
import type { GithubPrRow } from "@/lib/github/prs";
import { useLive } from "@/lib/hooks/use-fetch";
import { useStoredState } from "@/lib/hooks/use-stored-state";
import type { CalendarEvent } from "@/lib/google-calendar";
import {
  capHubList,
  hubCalendarEvents,
  HUB_LONG_LIST_PREVIEW,
  HUB_NOTES_PREVIEW,
  type WorkHubEvent,
  type WorkHubModel,
  type WorkHubNote,
  type WorkHubTask,
} from "@/lib/repos/work-hub";
import type { RepoInfo } from "@/app/repos/types";

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

/** Past this many queued items the backlog starts collapsed. */
const BACKLOG_AUTO_COLLAPSE = 4;

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
  // External edits (MCP, a teammate, another tab) land via poll or refocus;
  // 20s keeps that lag short without hammering the Jira/GitHub fan-out.
  const work = useLive<RepoWorkPayload>(`/api/repos/${encodeURIComponent(repo.name)}/work`, {
    refreshInterval: 20_000,
  });
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
  const calendar = useMemo(
    () => (model ? hubCalendarEvents(model) : []),
    [model],
  );
  // `?? []` inline would hand the memos below a fresh array every render.
  const degraded = useMemo(() => work.data?.degraded ?? [], [work.data?.degraded]);
  const otherTickets = useMemo(() => model?.openTickets ?? [], [model?.openTickets]);
  const backlogTasks = useMemo(() => model?.leftoverTasks ?? [], [model?.leftoverTasks]);
  const backlogCount = backlogTasks.length + otherTickets.length;
  const doneTasks = useMemo(() => work.data?.doneTasks ?? [], [work.data?.doneTasks]);

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
    () => backlogTasks.filter((task) => matchesTaskSearch(asHubTask(task), backlogQuery)),
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
    () => doneTasks.filter((task) => matchesTaskSearch(asHubTask(task), doneQuery)),
    [doneTasks, doneQuery],
  );

  // Links on every backlog row say nothing about any one row — hoist them.
  const sharedBacklogRefs = useMemo(
    () => commonTaskRefs(backlogTasks, { repoName: repo.name }),
    [backlogTasks, repo.name],
  );

  function openFileInGit(path: string) {
    setGitFocusPath(path);
    setGitOpen(true);
  }

  async function onTaskAdded() {
    // Today and the /repos cards read the same task list.
    void globalMutate("/api/tasks");
    await work.mutate();
  }

  function renderNote(note: WorkHubNote) {
    const age =
      note.ts && note.ts > 0 ? new Date(note.ts).toISOString().slice(0, 10) : undefined;
    return (
      <NoteListRow key={note.slug} note={note} className="repo-hub-row">
        <NotebookPen size={14} className="lib-card-icon" />
        <span className="repo-hub-row-main">
          <span className="repo-hub-row-title">{note.title}</span>
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
      <section className="mt-4">
        <h2 className="text-sm font-semibold text-text mb-2">Active work</h2>
        {degraded.length > 0 ? (
          <div className="mb-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={14} className="shrink-0 text-warning" aria-hidden />
              <p className="min-w-0 flex-1 text-sm text-text-muted" role="status">
                {degraded.map((entry) => entry.source).join(" and ")}{" "}
                couldn’t be loaded.
              </p>
              <button type="button" className="btn btn-ghost text-xs"
                disabled={work.isValidating} onClick={() => void work.mutate()}>
                <RefreshCw size={12} aria-hidden />
                {work.isValidating ? "Refreshing…" : "Retry"}
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
        {work.isLoading ? (
          <SkeletonRows count={3} />
        ) : work.error ? (
          <FetchError message={work.error.message} onRetry={() => void work.mutate()} />
        ) : model?.clusters.length ? (
          model.clusters.map((cluster) => (
            <HubWorkCluster
              key={cluster.id}
              cluster={cluster}
              date={work.data?.date ?? ""}
              repoName={repo.name}
              repoPath={repo.path}
              onWorkMutate={() => void work.mutate()}
            />
          ))
        ) : (
          <p className="text-xs text-text-subtle">No in-progress work linked to this repo.</p>
        )}
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
          sharedChips={
            <SharedEntityChips refs={sharedBacklogRefs} label="Shared by every backlog item" />
          }
        >
          {shownBacklogTasks.length + shownBacklogTickets.length === 0 ? (
            <p className="text-xs text-text-subtle">Nothing matches “{backlogQuery}”.</p>
          ) : (
            <div className="divide-y divide-border">
              {shownBacklogTasks.map((task) => (
                <HubTaskRow
                  key={task.id}
                  task={task}
                  date={work.data?.date ?? ""}
                  cwd={repo.path}
                  repoName={repo.name}
                  suppressLinks={sharedBacklogRefs}
                  onWorkMutate={() => void work.mutate()}
                />
              ))}
              {shownBacklogTickets.map((ticket) => (
                <JiraTicketQueueRow
                  key={ticket.key}
                  ticket={asHubJiraTicket(ticket)}
                  onTransitioned={() => void work.mutate()}
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
                render={(task) => <HubArchiveRow key={task.id} task={task} />}
              />
            </div>
          )}
        </HubSection>
      ) : null}

      <section className="mt-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-semibold text-text"
            aria-expanded={historyOpen}
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
        <div className="repo-hub-history repo-git-tab-body" data-collapsed={historyOpen ? undefined : ""}>
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

      <div className="repo-hub-columns mt-5">
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
              <summary>Other PRs ({others.length})</summary>
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
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">Notes</h2>
            <HubRepoNoteButton repoName={repo.name} repoPath={repo.path} />
          </div>
          {work.isLoading ? (
            <SkeletonRows count={3} />
          ) : model?.leftoverNotes.length ? (
            <div className="divide-y divide-border">
              <HubCappedList
                items={model.leftoverNotes}
                limit={HUB_NOTES_PREVIEW}
                render={renderNote}
              />
            </div>
          ) : (
            <p className="text-xs text-text-subtle">No notes linked to this repo.</p>
          )}
          {calendar.length > 0 ? (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-text mb-2">Calendar</h2>
              <div className="divide-y divide-border">
                <HubCappedList
                  items={calendar}
                  limit={HUB_LONG_LIST_PREVIEW}
                  render={renderEvent}
                />
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
