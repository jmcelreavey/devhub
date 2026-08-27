"use client";

/**
 * Front-and-center Link dialog — shared by task rows and note footers.
 * Portals via ModalShell so it is not tied to hover shelves.
 *
 * Every link kind is one entry in KIND_CONFIG below: an endpoint, a row
 * adapter, and its copy. The dialog itself knows nothing kind-specific, so
 * adding a kind is one config entry rather than another copy of the picker.
 *
 * Pickers load once per kind (SWR caches per endpoint, so tabbing back is
 * instant). Filtering is in-memory — no per-keystroke remote search.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { useLive } from "@/lib/hooks/use-fetch";
import { buildEntityRefFromInput } from "@/lib/entity-links/build-ref";
import { entityKey, type EntityKind, type EntityRef } from "@/lib/entity-note";
import type { CalendarEvent } from "@/lib/google-calendar";
import type { GithubPrRow, GithubPrsApiPayload } from "@/lib/github/prs";
import type { JiraTicket } from "@/lib/jira/client";
import type { Task } from "@/lib/tasks/types";
import type { ReposApiPayload } from "@/app/repos/types";
import { isDiagramStoragePath } from "@/lib/diagram-utils";
import { todayISO } from "@/lib/utils";

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
  /** Rendered before the title in a monospace-ish weight (Jira keys). */
  key?: string;
  /** Merged into the built EntityRef when this row is picked. */
  overrides?: Partial<EntityRef>;
}

interface RowContext {
  excludeTaskId?: string;
  today: string;
}

/**
 * Everything that differs between link kinds. `toRows` owns the shape of its
 * own endpoint payload; `defineKind` keeps that typed at the definition site
 * and erases it for the lookup table.
 */
interface KindConfig<TData> {
  label: string;
  /** Endpoint backing the picker, or null for paste-only kinds. */
  endpoint: string | null;
  toRows: (data: TData | undefined, ctx: RowContext) => PickRow[];
  /** True when the integration isn't set up — shows setupText, not emptyText. */
  isUnconfigured?: (data: TData | undefined) => boolean;
  setupText?: string;
  searchLabel: string;
  searchPlaceholder: string;
  hint: string;
  loadingText: string;
  emptyText: string;
  errorText: string;
  pasteLabel: string;
  pastePlaceholder: string;
}

function defineKind<TData>(config: KindConfig<TData>): KindConfig<unknown> {
  return config as KindConfig<unknown>;
}

function formatTaskDay(date: string, today: string): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function taskRows(days: TaskHistoryDay[] | undefined, ctx: RowContext): PickRow[] {
  if (!days?.length) return [];
  const seen = new Set<string>();
  const items: (PickRow & { date: string; open: boolean })[] = [];

  for (const day of days.slice(0, TASK_PICKER_DAY_LIMIT)) {
    for (const t of day.tasks) {
      if (t.id === ctx.excludeTaskId || t.movedAt || seen.has(t.id)) continue;
      seen.add(t.id);
      const status = t.abandonedAt ? "Abandoned" : t.done ? "Done" : null;
      items.push({
        id: t.id,
        title: t.text,
        meta: `${formatTaskDay(day.date, ctx.today)}${status ? ` · ${status}` : ""}`,
        date: day.date,
        open: !t.done && !t.abandonedAt,
        overrides: { label: t.text },
      });
    }
  }

  // Open before closed, today before older, newest day first.
  items.sort(
    (a, b) =>
      Number(b.open) - Number(a.open) ||
      Number(b.date === ctx.today) - Number(a.date === ctx.today) ||
      b.date.localeCompare(a.date) ||
      a.title.localeCompare(b.title),
  );
  return items;
}

function noteRows(tree: TreeNode[] | undefined): PickRow[] {
  if (!tree?.length) return [];
  const files: { row: PickRow; modified: number }[] = [];

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") {
        if (isDiagramStoragePath(node.path)) continue;
        const id = node.path.replace(/\.json$/i, "");
        const title = node.name.replace(/\.json$/i, "");
        files.push({
          row: {
            id,
            title,
            meta: id.includes("/") ? id.split("/").slice(0, -1).join("/") : "Notes",
            overrides: { label: title },
          },
          modified: node.modified ?? 0,
        });
      } else if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(tree);

  return files
    .sort((a, b) => b.modified - a.modified || a.row.title.localeCompare(b.row.title))
    .slice(0, NOTE_RECENT_FALLBACK)
    .map((f) => f.row);
}

function diagramRows(tree: TreeNode[] | undefined): PickRow[] {
  if (!tree?.length) return [];
  const files: { row: PickRow; modified: number }[] = [];

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") {
        if (!isDiagramStoragePath(node.path)) continue;
        const id = node.path.replace(/\.json$/i, "");
        const title = node.name.replace(/\.json$/i, "");
        const folder = id.includes("/")
          ? id.split("/").slice(1, -1).join("/") || "Diagrams"
          : "Diagrams";
        files.push({
          row: {
            id,
            title,
            meta: folder,
            overrides: { label: title },
          },
          modified: node.modified ?? 0,
        });
      } else if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(tree);

  return files
    .sort((a, b) => b.modified - a.modified || a.row.title.localeCompare(b.row.title))
    .slice(0, NOTE_RECENT_FALLBACK)
    .map((f) => f.row);
}

function prRows(data: GithubPrsApiPayload | undefined): PickRow[] {
  if (!data?.configured) return [];
  const all: GithubPrRow[] = [
    ...(data.authored ?? []),
    ...(data.reviews ?? []),
    ...(data.recentlyReviewed ?? []),
  ];
  const seen = new Set<string>();
  const out: PickRow[] = [];
  for (const row of all) {
    const id = row.url || `${row.repo}#${row.number}`;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const slug = `${row.repo}#${row.number}`;
    out.push({
      id,
      title: row.title || slug,
      meta: slug,
      // The dialog's paste path parses a URL into owner/repo#n; a picked row
      // already knows both, so pin the canonical id rather than the URL.
      overrides: { id: slug, label: row.title || slug },
    });
  }
  return out.slice(0, LIST_LIMIT);
}

function jiraRows(data: JiraResponse | undefined): PickRow[] {
  return (data?.tickets ?? []).slice(0, LIST_LIMIT).map((t) => ({
    id: t.key,
    title: t.summary || t.key,
    meta: t.status || t.key,
    key: t.key,
    overrides: {
      label: `${t.key}: ${t.summary || t.key}`,
      ...(t.url ? { href: t.url } : {}),
    },
  }));
}

function repoRows(data: ReposApiPayload | undefined): PickRow[] {
  return (data?.repos ?? []).map((repo) => ({
    id: repo.name,
    title: repo.name,
    meta: repo.branch || "Local repository",
    overrides: { label: repo.name },
  }));
}

function calendarRows(data: CalendarResponse | undefined): PickRow[] {
  return (data?.events ?? []).slice(0, LIST_LIMIT).map((ev) => ({
    id: ev.id,
    title: ev.title || "Untitled",
    meta: ev.isAllDay
      ? "All day"
      : new Date(ev.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    overrides: {
      label: ev.title || "Calendar event",
      href: ev.htmlLink || "/calendar",
    },
  }));
}

/** Tab order is the order of this map. */
const KIND_CONFIG = {
  calendar: defineKind<CalendarResponse>({
    label: "Calendar",
    endpoint: "/api/calendar",
    toRows: calendarRows,
    isUnconfigured: (data) => data?.needsReauth === true,
    setupText: "Calendar needs reconnect. Paste an event id below, or fix Google on Setup.",
    searchLabel: "Filter events",
    searchPlaceholder: "Filter today's events…",
    hint: "Today's events. Select one or more, then Add link.",
    loadingText: "Loading today's events…",
    emptyText: "No events loaded for today. Paste an event id or Calendar URL below.",
    errorText: "Couldn't load events. Paste an event id or Calendar URL below.",
    pasteLabel: "Event id or URL",
    pastePlaceholder: "Event id or https://calendar.google.com/…",
  }),
  pr: defineKind<GithubPrsApiPayload>({
    label: "PR",
    endpoint: "/api/github/prs",
    toRows: prRows,
    isUnconfigured: (data) => data?.configured === false,
    setupText: "GitHub CLI isn't signed in. Paste a PR URL below, or connect gh.",
    searchLabel: "Filter PRs",
    searchPlaceholder: "Filter open / review PRs…",
    hint: "From your cached PR list. Select one or more, then Add link.",
    loadingText: "Loading your PRs…",
    emptyText: "No open or review PRs cached. Paste a GitHub PR URL below.",
    errorText: "Couldn't load PRs. Paste a GitHub URL below.",
    pasteLabel: "PR URL",
    pastePlaceholder: "https://github.com/org/repo/pull/1",
  }),
  note: defineKind<TreeNode[]>({
    label: "Note",
    endpoint: "/api/tree",
    toRows: noteRows,
    searchLabel: "Search notes",
    searchPlaceholder: "Search notes…",
    hint: "Recent notes. Select one or more, then Add link.",
    loadingText: "Loading notes…",
    emptyText: "No notes found. Paste a vault path below.",
    errorText: "Couldn't load notes. Paste a vault path below.",
    pasteLabel: "Vault path",
    pastePlaceholder: "task-notes/2026-07-28-…",
  }),
  diagram: defineKind<TreeNode[]>({
    label: "Diagram",
    endpoint: "/api/tree",
    toRows: diagramRows,
    searchLabel: "Search diagrams",
    searchPlaceholder: "Search diagrams…",
    hint: "Recent diagrams. Select one or more, then Add link.",
    loadingText: "Loading diagrams…",
    emptyText: "No diagrams found. Paste a vault path below.",
    errorText: "Couldn't load diagrams. Paste a vault path below.",
    pasteLabel: "Diagram path",
    pastePlaceholder: "diagrams/Acme/Widget/…",
  }),
  repo: defineKind<ReposApiPayload>({
    label: "Repo",
    endpoint: "/api/repos",
    toRows: repoRows,
    searchLabel: "Search repositories",
    searchPlaceholder: "Search local repositories…",
    hint: "Local repositories. Select one or more, then Add link.",
    loadingText: "Loading repositories…",
    emptyText: "No local repositories found.",
    errorText: "Couldn't load repositories. Paste a repository name below.",
    pasteLabel: "Repository name",
    pastePlaceholder: "repository-name",
  }),
  jira: defineKind<JiraResponse>({
    label: "Jira",
    endpoint: "/api/jira/tickets",
    toRows: jiraRows,
    isUnconfigured: (data) => data?.configured === false || !!data?.error,
    setupText: "Jira isn't configured. Paste an issue key below, or finish Setup.",
    searchLabel: "Filter tickets",
    searchPlaceholder: "Filter your tickets…",
    hint: "From your cached ticket list. Select one or more, then Add link.",
    loadingText: "Loading your tickets…",
    emptyText: "No tickets in the cached list. Paste an issue key below.",
    errorText: "Couldn't load tickets. Paste an issue key below.",
    pasteLabel: "Issue key or URL",
    pastePlaceholder: "PTF-1234 or https://…/browse/PTF-1234",
  }),
  task: defineKind<TaskHistoryDay[]>({
    label: "Task",
    endpoint: "/api/tasks/history?includeTasks=1",
    toRows: taskRows,
    searchLabel: "Search tasks",
    searchPlaceholder: "Search tasks…",
    hint: "Today and recent days. Select one or more, then Add link.",
    loadingText: "Loading recent tasks…",
    emptyText: "No recent tasks found. Paste a task id below if you have one.",
    errorText: "Couldn't load tasks. Paste a task id below, or try again.",
    pasteLabel: "Task id",
    pastePlaceholder: "task-uuid",
  }),
} satisfies Partial<Record<EntityKind, KindConfig<unknown>>>;

type PickerKind = keyof typeof KIND_CONFIG;

const KIND_ORDER = Object.keys(KIND_CONFIG) as PickerKind[];

function isPickerKind(kind: EntityKind): kind is PickerKind {
  return kind in KIND_CONFIG;
}

function filterRows(rows: PickRow[], query: string): PickRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows.slice(0, LIST_LIMIT);
  return rows
    .filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.meta.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    )
    .slice(0, LIST_LIMIT);
}

function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

function idsInRange(visibleIds: string[], fromId: string, toId: string): string[] {
  const a = visibleIds.indexOf(fromId);
  const b = visibleIds.indexOf(toId);
  if (a < 0 || b < 0) return [toId];
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return visibleIds.slice(start, end + 1);
}

function unionIds(current: string[], add: string[]): string[] {
  const seen = new Set(current);
  const out = [...current];
  for (const id of add) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function selectionSummary(rows: PickRow[], selectedIds: string[]): string | null {
  if (selectedIds.length === 0) return null;
  const titles = selectedIds.map((id) => rows.find((r) => r.id === id)?.title ?? id);
  if (titles.length === 1) return `Selected: ${titles[0]}`;
  return `Selected: ${titles.length} · ${titles.join(", ")}`;
}

function refFromRow(kind: PickerKind, raw: string, rows: PickRow[]): EntityRef {
  const ref = buildEntityRefFromInput(kind, raw);
  const picked = rows.find((r) => r.id === raw);
  return picked?.overrides ? { ...ref, ...picked.overrides } : ref;
}

export interface EntityLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (refs: EntityRef[]) => Promise<void>;
  title?: string;
  description?: string;
  defaultKind?: EntityKind;
  /** When linking from a task row, omit that task so it cannot link to itself. */
  excludeTaskId?: string;
  /** Skip these on add — already linked to the source entity. */
  existing?: EntityRef[];
}

export function EntityLinkDialog({
  open,
  onClose,
  onSave,
  title = "Link to…",
  description = "Link a calendar event, PR, note, diagram, repo, Jira issue, or task.",
  defaultKind = "calendar",
  excludeTaskId,
  existing,
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
      defaultKind={isPickerKind(defaultKind) ? defaultKind : "calendar"}
      excludeTaskId={excludeTaskId}
      existing={existing}
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
  existing,
}: {
  onClose: () => void;
  onSave: (refs: EntityRef[]) => Promise<void>;
  title: string;
  description: string;
  defaultKind: PickerKind;
  excludeTaskId?: string;
  existing?: EntityRef[];
}) {
  const inputId = useId();
  const searchId = useId();
  const lastAnchorRef = useRef<string | null>(null);
  const [kind, setKind] = useState<PickerKind>(defaultKind);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = KIND_CONFIG[kind];
  const { data, error: loadError, isLoading } = useLive<unknown>(config.endpoint, {
    refreshInterval: 0,
  });

  const today = todayISO();
  const rows = useMemo(
    () => config.toRows(data, { excludeTaskId, today }),
    [config, data, excludeTaskId, today],
  );
  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);

  const unconfigured = !loadError && !!config.isUnconfigured?.(data);
  const settled = data !== undefined || !!loadError;
  const loading = !settled || (isLoading && data === undefined);

  // The paste field is the escape hatch: show it whenever the picker can't
  // offer what the user is after.
  const showPasteField = !!loadError || unconfigured || filtered.length === 0;
  const showPicker = !loading && !loadError && !unconfigured && rows.length > 0;

  const notice = loadError
    ? config.errorText
    : unconfigured
      ? (config.setupText ?? config.errorText)
      : rows.length === 0 && settled
        ? config.emptyText
        : null;

  const selectedLabel = selectionSummary(rows, selectedIds);
  const canSubmit = (selectedIds.length > 0 || pasteValue.trim().length > 0) && !busy;
  const addLabel =
    busy ? "Saving…" : selectedIds.length > 1 ? `Add ${selectedIds.length} links` : "Add link";

  const close = () => {
    if (busy) return;
    onClose();
  };

  const idsToSave = (): string[] => {
    if (selectedIds.length > 0) return selectedIds;
    const pasted = pasteValue.trim();
    if (pasted) return [pasted];
    if (activeId) return [activeId];
    if (filtered.length === 1) return [filtered[0].id];
    return [];
  };

  const save = async () => {
    const ids = idsToSave();
    if (ids.length === 0 || busy) return;
    if (kind === "task" && excludeTaskId && ids.every((id) => id === excludeTaskId)) {
      setError("Can't link a task to itself.");
      return;
    }
    const toBuild =
      kind === "task" && excludeTaskId ? ids.filter((id) => id !== excludeTaskId) : ids;
    setBusy(true);
    setError(null);
    try {
      const existingKeys = new Set((existing ?? []).map(entityKey));
      const seen = new Set<string>();
      const refs: EntityRef[] = [];
      for (const raw of toBuild) {
        const next = refFromRow(kind, raw, rows);
        const key = entityKey(next);
        if (seen.has(key) || existingKeys.has(key)) continue;
        seen.add(key);
        refs.push(next);
      }
      if (refs.length === 0) {
        setError("Already linked.");
        return;
      }
      await onSave(refs);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add link.");
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = (id: string, shiftKey: boolean) => {
    if (shiftKey && lastAnchorRef.current) {
      const range = idsInRange(
        filtered.map((r) => r.id),
        lastAnchorRef.current,
        id,
      );
      setSelectedIds((prev) => unionIds(prev, range));
    } else {
      setSelectedIds((prev) => toggleId(prev, id));
      lastAnchorRef.current = id;
    }
    setActiveId(id);
    setError(null);
  };

  const switchKind = (next: PickerKind) => {
    setKind(next);
    setSelectedIds([]);
    setActiveId("");
    setPasteValue("");
    setQuery("");
    setError(null);
    lastAnchorRef.current = null;
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
            {addLabel}
          </button>
        </div>
      }
    >
      <div className="entity-link-dialog-body">
        <div className="entity-link-kinds" role="tablist" aria-label="Link type">
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              className="entity-link-kind"
              data-active={kind === k ? "true" : undefined}
              role="tab"
              aria-selected={kind === k}
              onClick={() => switchKind(k)}
            >
              {KIND_CONFIG[k].label}
            </button>
          ))}
        </div>

        {loading ? <PickerSkeleton label={config.loadingText} /> : null}

        {showPicker ? (
          <PickerBlock
            searchId={searchId}
            config={config}
            query={query}
            onQueryChange={(next) => {
              setQuery(next);
              setError(null);
            }}
            rows={filtered}
            totalRows={rows.length}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggle={toggleRow}
            onActiveChange={setActiveId}
            onSubmit={() => void save()}
            selectedLabel={selectedLabel}
            busy={busy}
          />
        ) : null}

        {notice ? <p className="entity-link-hint">{notice}</p> : null}

        {showPasteField && !loading ? (
          <label className="entity-link-field" htmlFor={inputId}>
            <span className="entity-link-field-label">{config.pasteLabel}</span>
            <input
              id={inputId}
              className="input entity-link-input"
              placeholder={config.pastePlaceholder}
              value={pasteValue}
              onChange={(e) => {
                setPasteValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              autoFocus={!showPicker}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ) : null}

        {error ? (
          <p className="entity-link-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </ModalShell>
  );
}

/** Shimmer in the list's silhouette — content arriving never spins. */
function PickerSkeleton({ label }: { label: string }): ReactNode {
  return (
    <div className="entity-link-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <span className="entity-link-skeleton-field" aria-hidden />
      <span className="entity-link-skeleton-list" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="entity-link-skeleton-row" />
        ))}
      </span>
    </div>
  );
}

/**
 * Search + roving-focus listbox. Arrows move the highlight, click/Space toggles
 * selection, Enter commits — so the whole dialog is reachable without a mouse.
 */
function PickerBlock({
  searchId,
  config,
  query,
  onQueryChange,
  rows,
  totalRows,
  selectedIds,
  activeId,
  onToggle,
  onActiveChange,
  onSubmit,
  selectedLabel,
  busy,
}: {
  searchId: string;
  config: KindConfig<unknown>;
  query: string;
  onQueryChange: (v: string) => void;
  rows: PickRow[];
  totalRows: number;
  selectedIds: string[];
  activeId: string;
  onToggle: (id: string, shiftKey: boolean) => void;
  onActiveChange: (id: string) => void;
  onSubmit: () => void;
  selectedLabel: string | null;
  busy: boolean;
}) {
  const listId = useId();
  const activeIndex = rows.findIndex((r) => r.id === activeId);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const selected = new Set(selectedIds);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const from = activeIndex < 0 ? (delta > 0 ? -1 : 0) : activeIndex;
    const next = (from + delta + rows.length) % rows.length;
    onActiveChange(rows[next].id);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="entity-link-picker">
      <label className="entity-link-field" htmlFor={searchId}>
        <span className="entity-link-field-label">{config.searchLabel}</span>
        <input
          id={searchId}
          className="input entity-link-input"
          placeholder={config.searchPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoFocus
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {rows.length === 0 ? (
        <p className="entity-link-hint">
          {`No matches for "${query.trim()}". Paste one below instead.`}
        </p>
      ) : (
        <>
          <p className="entity-link-hint">{config.hint}</p>
          <ul
            id={listId}
            className="entity-link-cal-list"
            role="listbox"
            aria-label={config.searchLabel}
            aria-multiselectable="true"
          >
            {rows.map((row, i) => {
              const isSelected = selected.has(row.id);
              const isActive = activeId === row.id;
              return (
                <li key={row.id} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    ref={isActive ? activeRef : undefined}
                    className="entity-link-cal-item"
                    data-selected={isSelected ? "true" : undefined}
                    data-active={isActive ? "true" : undefined}
                    disabled={busy}
                    onClick={(e) => onToggle(row.id, e.shiftKey)}
                    onKeyDown={onKeyDown}
                  >
                    <span className="entity-link-cal-title">
                      {row.key ? <span className="entity-link-pick-key">{row.key}</span> : null}
                      {row.key ? " " : null}
                      {row.title || "Untitled"}
                    </span>
                    <span className="entity-link-cal-time">{row.meta}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="entity-link-hint entity-link-hint-or">
            {selectedLabel
              ? selectedLabel
              : totalRows > rows.length
                ? `Showing ${rows.length} of ${totalRows}. Keep typing to narrow.`
                : "↑↓ to move, click to toggle, Enter to link."}
          </p>
        </>
      )}
    </div>
  );
}
