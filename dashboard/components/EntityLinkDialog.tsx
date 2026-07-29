"use client";

/**
 * Front-and-center Link dialog — shared by task rows and note footers.
 * Portals via ModalShell so it is not tied to hover shelves.
 *
 * Pickers load once per kind (local files or server-cached PR/Jira lists).
 * Filtering is in-memory — no per-keystroke remote search.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { useLive } from "@/lib/hooks/use-fetch";
import { buildEntityRefFromInput } from "@/lib/entity-links/build-ref";
import type { EntityKind, EntityRef } from "@/lib/entity-note";
import type { CalendarEvent } from "@/lib/google-calendar";
import type { GithubPrRow, GithubPrsApiPayload } from "@/lib/github/prs";
import type { JiraTicket } from "@/lib/jira/client";
import type { Task } from "@/lib/tasks/types";
import type { ReposApiPayload } from "@/app/repos/types";
import { isDiagramStoragePath } from "@/lib/diagram-utils";
import { todayISO } from "@/lib/utils";

const KINDS: { id: EntityKind; label: string; hint: string }[] = [
  { id: "calendar", label: "Calendar", hint: "Pick today's event or paste an event id / Calendar URL" },
  { id: "pr", label: "PR", hint: "Pick from your open PRs, or paste a GitHub PR URL" },
  { id: "note", label: "Note", hint: "Search notes by title, or paste a vault path" },
  { id: "repo", label: "Repo", hint: "Pick a local repository" },
  { id: "jira", label: "Jira", hint: "Pick from your tickets, or paste an issue key" },
  { id: "task", label: "Task", hint: "Search recent tasks by name" },
];

const PLACEHOLDERS: Record<EntityKind, string> = {
  calendar: "Event id or https://calendar.google.com/…",
  pr: "https://github.com/org/repo/pull/1",
  note: "task-notes/2026-07-28-…",
  jira: "PTF-1234",
  task: "task-uuid",
  meeting: "meeting id",
  repo: "repository-name",
};

const TASK_PICKER_DAY_LIMIT = 14;
const LIST_LIMIT = 40;
const NOTE_RECENT_FALLBACK = 60;

interface CalendarResponse {
  events?: CalendarEvent[];
  needsReauth?: boolean;
}

interface TaskHistoryDay {
  date: string;
  tasks: Task[];
}

interface JiraResponse {
  tickets?: JiraTicket[];
  configured?: boolean;
  error?: string;
}

interface TreeNode {
  type: string;
  name: string;
  path: string;
  modified?: number;
  children?: TreeNode[];
}

interface PickRow {
  id: string;
  title: string;
  meta: string;
}

interface TaskPickOption extends PickRow {
  date: string;
  done: boolean;
  abandoned: boolean;
}

function formatTaskDay(date: string, today: string): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function taskStatusLabel(opt: TaskPickOption): string {
  if (opt.abandoned) return "Abandoned";
  if (opt.done) return "Done";
  return "Open";
}

function flattenTaskOptions(
  days: TaskHistoryDay[] | undefined,
  excludeTaskId: string | undefined,
): TaskPickOption[] {
  if (!days?.length) return [];
  const today = todayISO();
  const seen = new Set<string>();
  const items: TaskPickOption[] = [];

  for (const day of days.slice(0, TASK_PICKER_DAY_LIMIT)) {
    for (const t of day.tasks) {
      if (excludeTaskId && t.id === excludeTaskId) continue;
      if (t.movedAt) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      items.push({
        id: t.id,
        title: t.text,
        meta: "",
        date: day.date,
        done: t.done,
        abandoned: !!t.abandonedAt,
      });
    }
  }

  items.sort((a, b) => {
    const aOpen = !a.done && !a.abandoned ? 0 : 1;
    const bOpen = !b.done && !b.abandoned ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    const aToday = a.date === today ? 0 : 1;
    const bToday = b.date === today ? 0 : 1;
    if (aToday !== bToday) return aToday - bToday;
    return b.date.localeCompare(a.date) || a.title.localeCompare(b.title);
  });

  return items;
}

function flattenNoteOptions(tree: TreeNode[] | undefined): PickRow[] {
  if (!tree?.length) return [];
  const files: { id: string; title: string; meta: string; modified: number }[] = [];

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") {
        if (isDiagramStoragePath(node.path)) continue;
        const id = node.path.replace(/\.json$/i, "");
        files.push({
          id,
          title: node.name.replace(/\.json$/i, ""),
          meta: id.includes("/") ? id.split("/").slice(0, -1).join("/") : "Notes",
          modified: node.modified ?? 0,
        });
      } else if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(tree);

  return files
    .sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title))
    .slice(0, NOTE_RECENT_FALLBACK)
    .map(({ id, title, meta }) => ({ id, title, meta }));
}

function flattenPrOptions(data: GithubPrsApiPayload | undefined): PickRow[] {
  if (!data?.configured) return [];
  const rows: GithubPrRow[] = [
    ...(data.authored ?? []),
    ...(data.reviews ?? []),
    ...(data.recentlyReviewed ?? []),
  ];
  const seen = new Set<string>();
  const out: PickRow[] = [];
  for (const row of rows) {
    const id = row.url || `${row.repo}#${row.number}`;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: row.title || `${row.repo}#${row.number}`,
      meta: `${row.repo}#${row.number}`,
    });
  }
  return out.slice(0, LIST_LIMIT);
}

function flattenJiraOptions(tickets: JiraTicket[] | undefined): PickRow[] {
  if (!tickets?.length) return [];
  return tickets.slice(0, LIST_LIMIT).map((t) => ({
    id: t.key,
    title: t.summary || t.key,
    meta: t.status || t.key,
  }));
}

function flattenRepoOptions(data: ReposApiPayload | undefined): PickRow[] {
  return (data?.repos ?? []).map((repo) => ({
    id: repo.name,
    title: repo.name,
    meta: repo.branch || "Local repository",
  }));
}

function filterRows(rows: PickRow[], query: string): PickRow[] {
  const q = query.trim().toLowerCase();
  const list = !q
    ? rows
    : rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.meta.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q),
      );
  return list.slice(0, LIST_LIMIT);
}

export interface EntityLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (ref: EntityRef) => Promise<void>;
  title?: string;
  description?: string;
  defaultKind?: EntityKind;
  /** When linking from a task row, omit that task so it cannot link to itself. */
  excludeTaskId?: string;
}

export function EntityLinkDialog({
  open,
  onClose,
  onSave,
  title = "Link to…",
  description = "Link a calendar event, PR, note, repo, Jira issue, or task.",
  defaultKind = "calendar",
  excludeTaskId,
}: EntityLinkDialogProps) {
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new Event("devhub:dismiss-hovertips"));
  }, [open]);

  if (!open) return null;

  return (
    <EntityLinkDialogSession
      onClose={onClose}
      onSave={onSave}
      title={title}
      description={description}
      defaultKind={defaultKind}
      excludeTaskId={excludeTaskId}
    />
  );
}

function EntityLinkDialogSession({
  onClose,
  onSave,
  title,
  description,
  defaultKind,
  excludeTaskId,
}: {
  onClose: () => void;
  onSave: (ref: EntityRef) => Promise<void>;
  title: string;
  description: string;
  defaultKind: EntityKind;
  excludeTaskId?: string;
}) {
  const inputId = useId();
  const searchId = useId();
  const [kind, setKind] = useState<EntityKind>(defaultKind);
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: cal } = useLive<CalendarResponse>(kind === "calendar" ? "/api/calendar" : null, {
    refreshInterval: 0,
  });

  const {
    data: taskDays,
    error: taskLoadError,
    isLoading: taskLoading,
  } = useLive<TaskHistoryDay[]>(kind === "task" ? "/api/tasks/history?includeTasks=1" : null, {
    refreshInterval: 0,
  });

  const {
    data: noteTree,
    error: noteLoadError,
    isLoading: noteLoading,
  } = useLive<TreeNode[]>(kind === "note" ? "/api/tree" : null, {
    refreshInterval: 0,
  });

  const {
    data: prData,
    error: prLoadError,
    isLoading: prLoading,
  } = useLive<GithubPrsApiPayload>(kind === "pr" ? "/api/github/prs" : null, {
    refreshInterval: 0,
  });

  const {
    data: jiraData,
    error: jiraLoadError,
    isLoading: jiraLoading,
  } = useLive<JiraResponse>(kind === "jira" ? "/api/jira/tickets" : null, {
    refreshInterval: 0,
  });

  const {
    data: repoData,
    error: repoLoadError,
    isLoading: repoLoading,
  } = useLive<ReposApiPayload>(kind === "repo" ? "/api/repos" : null, {
    refreshInterval: 0,
  });

  const events = useMemo(() => cal?.events ?? [], [cal?.events]);
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? events
      : events.filter((e) => (e.title || "").toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
    return list.slice(0, 12);
  }, [events, query]);
  const calReady = cal !== undefined;

  const taskOptions = useMemo(
    () => flattenTaskOptions(taskDays, excludeTaskId),
    [taskDays, excludeTaskId],
  );
  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? taskOptions
      : taskOptions.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            t.date.includes(q),
        );
    return list.slice(0, LIST_LIMIT);
  }, [taskOptions, query]);

  const noteOptions = useMemo(() => flattenNoteOptions(noteTree), [noteTree]);
  const filteredNotes = useMemo(() => filterRows(noteOptions, query), [noteOptions, query]);

  const prOptions = useMemo(() => flattenPrOptions(prData), [prData]);
  const filteredPrs = useMemo(() => filterRows(prOptions, query), [prOptions, query]);

  const jiraOptions = useMemo(() => flattenJiraOptions(jiraData?.tickets), [jiraData?.tickets]);
  const filteredJira = useMemo(() => filterRows(jiraOptions, query), [jiraOptions, query]);
  const repoOptions = useMemo(() => flattenRepoOptions(repoData), [repoData]);
  const filteredRepos = useMemo(() => filterRows(repoOptions, query), [repoOptions, query]);

  const selectedLabel = useMemo(() => {
    if (!value) return null;
    if (kind === "task") return taskOptions.find((t) => t.id === value)?.title ?? null;
    if (kind === "note") return noteOptions.find((t) => t.id === value)?.title ?? null;
    if (kind === "pr") return prOptions.find((t) => t.id === value)?.title ?? null;
    if (kind === "jira") {
      const hit = jiraOptions.find((t) => t.id === value);
      return hit ? `${hit.id} ${hit.title}` : null;
    }
    if (kind === "repo") return repoOptions.find((repo) => repo.id === value)?.title ?? null;
    return null;
  }, [kind, value, taskOptions, noteOptions, prOptions, jiraOptions, repoOptions]);

  const today = todayISO();
  const kindMeta = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  const canSubmit = value.trim().length > 0 && !busy;

  const tasksReady = taskDays !== undefined || !!taskLoadError;
  const notesReady = noteTree !== undefined || !!noteLoadError;
  const prsReady = prData !== undefined || !!prLoadError;
  const jiraReady = jiraData !== undefined || !!jiraLoadError;
  const reposReady = repoData !== undefined || !!repoLoadError;

  const showPasteField = (() => {
    if (kind === "calendar") return true;
    if (kind === "task") {
      return (
        !!taskLoadError ||
        (tasksReady && taskOptions.length === 0) ||
        (tasksReady && !taskLoadError && filteredTasks.length === 0)
      );
    }
    if (kind === "note") {
      return (
        !!noteLoadError ||
        (notesReady && noteOptions.length === 0) ||
        (notesReady && !noteLoadError && filteredNotes.length === 0)
      );
    }
    if (kind === "pr") {
      return (
        !!prLoadError ||
        (prsReady && prOptions.length === 0) ||
        (prsReady && !prLoadError && filteredPrs.length === 0) ||
        prData?.configured === false
      );
    }
    if (kind === "jira") {
      return (
        !!jiraLoadError ||
        jiraData?.configured === false ||
        (jiraReady && jiraOptions.length === 0) ||
        (jiraReady && !jiraLoadError && filteredJira.length === 0)
      );
    }
    if (kind === "repo") {
      return (
        !!repoLoadError ||
        (reposReady && repoOptions.length === 0) ||
        (reposReady && !repoLoadError && filteredRepos.length === 0)
      );
    }
    return true;
  })();

  const close = () => {
    if (busy) return;
    onClose();
  };

  const save = async (overrideValue?: string) => {
    const raw = (overrideValue ?? value).trim();
    if (!raw || busy) return;
    if (kind === "task" && excludeTaskId && raw === excludeTaskId) {
      setError("Can't link a task to itself.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ref = buildEntityRefFromInput(kind, raw);
      if (kind === "calendar" && overrideValue) {
        const picked = events.find((e) => e.id === raw);
        if (picked) {
          ref.label = picked.title || "Calendar event";
          ref.href = picked.htmlLink || "/calendar";
        }
      }
      if (kind === "task") {
        const picked = taskOptions.find((t) => t.id === raw);
        if (picked) ref.label = picked.title;
      }
      if (kind === "note") {
        const picked = noteOptions.find((t) => t.id === raw);
        if (picked) ref.label = picked.title;
      }
      if (kind === "pr") {
        const picked = prOptions.find((t) => t.id === raw);
        if (picked) {
          ref.label = picked.title;
          if (picked.meta) ref.id = picked.meta;
        }
      }
      if (kind === "jira") {
        const picked = jiraOptions.find((t) => t.id === raw);
        if (picked) {
          ref.label = `${picked.id}: ${picked.title}`;
          if (jiraData?.tickets) {
            const ticket = jiraData.tickets.find((t) => t.key === raw);
            if (ticket?.url) ref.href = ticket.url;
          }
        }
      }
      if (kind === "repo") {
        const picked = repoOptions.find((repo) => repo.id === raw);
        if (picked) ref.label = picked.title;
      }
      await onSave(ref);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add link.");
    } finally {
      setBusy(false);
    }
  };

  const selectRow = (id: string) => {
    setValue(id);
    setError(null);
  };

  const resetKind = (next: EntityKind) => {
    setKind(next);
    setValue("");
    setQuery("");
    setError(null);
  };

  return (
    <ModalShell
      open
      onClose={close}
      title={title}
      description={description}
      maxWidth="max-w-lg"
      footer={
        <div className="entity-link-dialog-actions">
          <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs"
            disabled={!canSubmit}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Add link"}
          </button>
        </div>
      }
    >
      <div className="entity-link-dialog-body">
        <div className="entity-link-kinds" role="tablist" aria-label="Link type">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className="entity-link-kind"
              data-active={kind === k.id ? "true" : undefined}
              role="tab"
              aria-selected={kind === k.id}
              onClick={() => resetKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>

        {kind === "calendar" ? (
          <div className="entity-link-cal-picker">
            {!calReady ? (
              <p className="entity-link-hint">Loading today&apos;s events…</p>
            ) : cal?.needsReauth ? (
              <p className="entity-link-hint">
                Calendar needs reconnect. Paste an event id below, or fix Google on Setup.
              </p>
            ) : events.length > 0 ? (
              <>
                {events.length > 5 ? (
                  <label className="entity-link-field" htmlFor={searchId}>
                    <span className="entity-link-field-label">Filter events</span>
                    <input
                      id={searchId}
                      className="input entity-link-input"
                      placeholder="Filter today's events…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                <p className="entity-link-hint">Today&apos;s events. Click one to link.</p>
                {filteredEvents.length > 0 ? (
                  <ul className="entity-link-cal-list">
                    {filteredEvents.map((ev) => (
                      <li key={ev.id}>
                        <button
                          type="button"
                          className="entity-link-cal-item"
                          disabled={busy}
                          onClick={() => void save(ev.id)}
                        >
                          <span className="entity-link-cal-title">{ev.title || "Untitled"}</span>
                          <span className="entity-link-cal-time">
                            {ev.isAllDay
                              ? "All day"
                              : new Date(ev.start).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="entity-link-hint">No events match that filter.</p>
                )}
                <p className="entity-link-hint entity-link-hint-or">Or paste an id / URL</p>
              </>
            ) : (
              <p className="entity-link-hint">
                No events loaded for today. Paste a Calendar event id or Google Calendar URL.
              </p>
            )}
          </div>
        ) : null}

        {kind === "task" ? (
          <PickerBlock
            searchId={searchId}
            searchLabel="Search tasks"
            searchPlaceholder="Search tasks…"
            query={query}
            onQueryChange={setQuery}
            loading={!tasksReady || (taskLoading && !taskDays)}
            loadingText="Loading recent tasks…"
            error={taskLoadError ? "Couldn't load tasks. Paste a task id below, or try again." : null}
            empty={!taskLoadError && tasksReady && taskOptions.length === 0}
            emptyText="No recent tasks found. Paste a task id below if you have one."
            noMatch={taskOptions.length > 0 && filteredTasks.length === 0}
            noMatchText={`No tasks match "${query.trim()}". Paste an id below if you need one outside this list.`}
            hint="Today and recent days. Select one, then Add link."
            selectedLabel={selectedLabel}
            busy={busy}
            autoFocusSearch
          >
            {filteredTasks.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt.id}
                  className="entity-link-cal-item"
                  data-selected={value === opt.id ? "true" : undefined}
                  disabled={busy}
                  onClick={() => selectRow(opt.id)}
                >
                  <span className="entity-link-cal-title">{opt.title || "Untitled"}</span>
                  <span className="entity-link-cal-time">
                    {formatTaskDay(opt.date, today)}
                    {opt.done || opt.abandoned ? ` · ${taskStatusLabel(opt)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </PickerBlock>
        ) : null}

        {kind === "note" ? (
          <PickerBlock
            searchId={searchId}
            searchLabel="Search notes"
            searchPlaceholder="Search notes…"
            query={query}
            onQueryChange={setQuery}
            loading={!notesReady || (noteLoading && !noteTree)}
            loadingText="Loading notes…"
            error={noteLoadError ? "Couldn't load notes. Paste a vault path below." : null}
            empty={!noteLoadError && notesReady && noteOptions.length === 0}
            emptyText="No notes found. Paste a vault path below."
            noMatch={noteOptions.length > 0 && filteredNotes.length === 0}
            noMatchText={`No notes match "${query.trim()}". Paste a path below.`}
            hint="Recent notes. Select one, then Add link."
            selectedLabel={selectedLabel}
            busy={busy}
            autoFocusSearch
          >
            {filteredNotes.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt.id}
                  className="entity-link-cal-item"
                  data-selected={value === opt.id ? "true" : undefined}
                  disabled={busy}
                  onClick={() => selectRow(opt.id)}
                >
                  <span className="entity-link-cal-title">{opt.title || "Untitled"}</span>
                  <span className="entity-link-cal-time">{opt.meta}</span>
                </button>
              </li>
            ))}
          </PickerBlock>
        ) : null}

        {kind === "pr" ? (
          <PickerBlock
            searchId={searchId}
            searchLabel="Filter PRs"
            searchPlaceholder="Filter open / review PRs…"
            query={query}
            onQueryChange={setQuery}
            loading={!prsReady || (prLoading && !prData)}
            loadingText="Loading your PRs…"
            error={
              prLoadError
                ? "Couldn't load PRs. Paste a GitHub URL below."
                : prData?.configured === false
                  ? "GitHub CLI isn't signed in. Paste a PR URL below, or connect gh."
                  : null
            }
            empty={prsReady && prData?.configured !== false && !prLoadError && prOptions.length === 0}
            emptyText="No open or review PRs cached. Paste a GitHub PR URL below."
            noMatch={prOptions.length > 0 && filteredPrs.length === 0}
            noMatchText={`No PRs match "${query.trim()}". Paste a URL below.`}
            hint="From your cached PR list. Select one, then Add link."
            selectedLabel={selectedLabel}
            busy={busy}
            autoFocusSearch={prOptions.length > 0}
          >
            {filteredPrs.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt.id}
                  className="entity-link-cal-item"
                  data-selected={value === opt.id ? "true" : undefined}
                  disabled={busy}
                  onClick={() => selectRow(opt.id)}
                >
                  <span className="entity-link-cal-title">{opt.title}</span>
                  <span className="entity-link-cal-time">{opt.meta}</span>
                </button>
              </li>
            ))}
          </PickerBlock>
        ) : null}

        {kind === "jira" ? (
          <PickerBlock
            searchId={searchId}
            searchLabel="Filter tickets"
            searchPlaceholder="Filter your tickets…"
            query={query}
            onQueryChange={setQuery}
            loading={!jiraReady || (jiraLoading && !jiraData)}
            loadingText="Loading your tickets…"
            error={
              jiraLoadError || jiraData?.error
                ? "Couldn't load tickets. Paste an issue key below."
                : jiraData?.configured === false
                  ? "Jira isn't configured. Paste an issue key below, or finish Setup."
                  : null
            }
            empty={
              jiraReady && jiraData?.configured !== false && !jiraLoadError && jiraOptions.length === 0
            }
            emptyText="No tickets in the cached list. Paste an issue key below."
            noMatch={jiraOptions.length > 0 && filteredJira.length === 0}
            noMatchText={`No tickets match "${query.trim()}". Paste a key below.`}
            hint="From your cached ticket list. Select one, then Add link."
            selectedLabel={selectedLabel}
            busy={busy}
            autoFocusSearch={jiraOptions.length > 0}
          >
            {filteredJira.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt.id}
                  className="entity-link-cal-item"
                  data-selected={value === opt.id ? "true" : undefined}
                  disabled={busy}
                  onClick={() => selectRow(opt.id)}
                >
                  <span className="entity-link-cal-title">
                    <span className="entity-link-pick-key">{opt.id}</span> {opt.title}
                  </span>
                  <span className="entity-link-cal-time">{opt.meta}</span>
                </button>
              </li>
            ))}
          </PickerBlock>
        ) : null}

        {kind === "repo" ? (
          <PickerBlock
            searchId={searchId}
            searchLabel="Search repositories"
            searchPlaceholder="Search local repositories…"
            query={query}
            onQueryChange={setQuery}
            loading={!reposReady || (repoLoading && !repoData)}
            loadingText="Loading repositories…"
            error={repoLoadError ? "Couldn't load repositories. Paste a repository name below." : null}
            empty={!repoLoadError && reposReady && repoOptions.length === 0}
            emptyText="No local repositories found."
            noMatch={repoOptions.length > 0 && filteredRepos.length === 0}
            noMatchText={`No repositories match "${query.trim()}". Paste the folder name below.`}
            hint="Local repositories. Select one, then Add link."
            selectedLabel={selectedLabel}
            busy={busy}
            autoFocusSearch
          >
            {filteredRepos.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt.id}
                  className="entity-link-cal-item"
                  data-selected={value === opt.id ? "true" : undefined}
                  disabled={busy}
                  onClick={() => selectRow(opt.id)}
                >
                  <span className="entity-link-cal-title">{opt.title}</span>
                  <span className="entity-link-cal-time">{opt.meta}</span>
                </button>
              </li>
            ))}
          </PickerBlock>
        ) : null}

        {kind !== "calendar" &&
        kind !== "task" &&
        kind !== "note" &&
        kind !== "pr" &&
        kind !== "jira" &&
        kind !== "repo" ? (
          <p className="entity-link-hint">{kindMeta.hint}</p>
        ) : null}

        {showPasteField ? (
          <label className="entity-link-field" htmlFor={inputId}>
            <span className="entity-link-field-label">
              {kind === "calendar"
                ? "Event id or URL"
                : kind === "task"
                  ? "Task id"
                  : kind === "note"
                    ? "Vault path"
                    : kind === "pr"
                      ? "PR URL"
                      : kind === "jira"
                        ? "Issue key"
                        : kind === "repo"
                          ? "Repository name"
                        : kindMeta.label}
            </span>
            <input
              id={inputId}
              className="input entity-link-input"
              placeholder={PLACEHOLDERS[kind]}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              autoFocus={
                kind === "calendar"
                  ? calReady && events.length === 0
                  : showPasteField &&
                    ((kind === "task" && (taskLoadError || taskOptions.length === 0)) ||
                      (kind === "note" && (noteLoadError || noteOptions.length === 0)) ||
                      (kind === "pr" && (prLoadError || prOptions.length === 0 || prData?.configured === false)) ||
                      (kind === "jira" &&
                        (!!jiraLoadError || jiraOptions.length === 0 || jiraData?.configured === false)) ||
                      (kind === "repo" && (!!repoLoadError || repoOptions.length === 0)) ||
                      (kind !== "task" && kind !== "note" && kind !== "pr" && kind !== "jira" && kind !== "repo"))
              }
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ) : null}

        {error ? <p className="entity-link-error" role="alert">{error}</p> : null}
      </div>
    </ModalShell>
  );
}

function PickerBlock({
  searchId,
  searchLabel,
  searchPlaceholder,
  query,
  onQueryChange,
  loading,
  loadingText,
  error,
  empty,
  emptyText,
  noMatch,
  noMatchText,
  hint,
  selectedLabel,
  busy,
  autoFocusSearch,
  children,
}: {
  searchId: string;
  searchLabel: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (v: string) => void;
  loading: boolean;
  loadingText: string;
  error: string | null;
  empty: boolean;
  emptyText: string;
  noMatch: boolean;
  noMatchText: string;
  hint: string;
  selectedLabel: string | null;
  busy: boolean;
  autoFocusSearch?: boolean;
  children: ReactNode;
}) {
  if (loading) return <p className="entity-link-hint">{loadingText}</p>;
  if (error) return <p className="entity-link-hint">{error}</p>;
  if (empty) return <p className="entity-link-hint">{emptyText}</p>;

  return (
    <div className="entity-link-task-picker">
      <label className="entity-link-field" htmlFor={searchId}>
        <span className="entity-link-field-label">{searchLabel}</span>
        <input
          id={searchId}
          className="input entity-link-input"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus={autoFocusSearch}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {noMatch ? (
        <p className="entity-link-hint">{noMatchText}</p>
      ) : (
        <>
          <p className="entity-link-hint">{hint}</p>
          <ul className="entity-link-cal-list" role="listbox" aria-label={searchLabel}>
            {children}
          </ul>
          {selectedLabel ? (
            <p className="entity-link-hint entity-link-hint-or">Selected: {selectedLabel}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
