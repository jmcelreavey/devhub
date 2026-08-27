"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, NotebookPen } from "lucide-react";
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
import { commonTaskRefs } from "@/lib/repos/hub-chips";
import { matchesTaskSearch } from "@/lib/tasks/task-text";
import { partitionRepoOpenPrs } from "@/lib/github/partition-repo-prs";
import type { GithubPrsApiPayload, GithubPrRow } from "@/lib/github/prs";
import { useGithubPrSearch } from "@/lib/hooks/use-github-pr-search";
import { useLive } from "@/lib/hooks/use-fetch";
import { useStoredState } from "@/lib/hooks/use-stored-state";
import { useToast } from "@/lib/hooks/use-toast";
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
  const toast = useToast();
  const work = useLive<RepoWorkPayload>(`/api/repos/${encodeURIComponent(repo.name)}/work`);
  const authored = useLive<GithubPrsApiPayload>("/api/github/prs", { refreshInterval: 0 });
  const fullName = work.data?.fullName ?? null;
  const prs = useGithubPrSearch(fullName ? `repo:${fullName} is:open` : "", Boolean(fullName), 0);
  const partitioned = useMemo(
    () => partitionRepoOpenPrs(prs.results, authored.data?.authored ?? []),
    [prs.results, authored.data?.authored],
  );
  const mine = useMemo(() => sortPrsNewest(partitioned.mine), [partitioned.mine]);
  const others = useMemo(() => sortPrsNewest(partitioned.others), [partitioned.others]);
  const [historyOpen, setHistoryOpen] = useStoredState(
    "devhub:repo-hub:history-open",
    false,
    (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
    (value) => (value ? "1" : "0"),
  );
  const [gitOpen, setGitOpen] = useState(false);
  const [gitFocusPath, setGitFocusPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
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

  async function addLinkedTask() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          links: [{ kind: "repo", id: repo.name, label: repo.name }],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDraft("");
      await work.mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add task");
    } finally {
      setSaving(false);
    }
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
          <div className="tone-panel tone-panel--warning-banner mb-3 py-2" role="status">
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <AlertTriangle size={14} className="text-warning" aria-hidden />
              {degraded.map((entry) => entry.source).join(" and ")}{" "}
              {degraded.length > 1 ? "are" : "is"} unavailable — some work may be missing.
              <button
                type="button"
                className="btn btn-ghost ml-auto"
                onClick={() => void work.mutate()}
              >
                Retry
              </button>
            </div>
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
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addLinkedTask();
          }}
        >
          <input
            className="input task-add-text flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Add a task for ${repo.name}`}
            aria-label={`Add a task linked to ${repo.name}`}
          />
          <button type="submit" className="btn btn-ghost text-xs" disabled={saving || !draft.trim()}>
            Add
          </button>
        </form>
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
                <JiraTicketQueueRow key={ticket.key} ticket={asHubJiraTicket(ticket)} />
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
          {prs.loading ? (
            <SkeletonRows count={3} />
          ) : prs.error ? (
            <FetchError message={prs.error} onRetry={prs.retry} />
          ) : mine.length ? (
            <div className="divide-y divide-border">
              <HubCappedList
                items={mine}
                limit={HUB_LONG_LIST_PREVIEW}
                render={(row) => <PrRow key={row.url} row={row} kind="authored" />}
              />
            </div>
          ) : (
            <p className="text-xs text-text-subtle">No open PRs of yours.</p>
          )}
          {others.length > 0 ? (
            <details className="repo-hub-other-prs">
              <summary>Other PRs ({others.length})</summary>
              <div className="divide-y divide-border mt-2">
                <HubCappedList
                  items={others}
                  limit={HUB_LONG_LIST_PREVIEW}
                  render={(row) => <PrRow key={row.url} row={row} kind="reviewed" />}
                />
              </div>
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
            <p className="text-xs text-text-subtle">No leftover notes for this repo.</p>
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
