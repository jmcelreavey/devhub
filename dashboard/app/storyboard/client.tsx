"use client";

import { decidePlan } from "./board-actions";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TASK_NOTE_STATUS_LABEL, type TaskNoteStatus } from "@shared/task-note/meta.ts";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { FetchError } from "@/components/ui/FetchError";
import { SearchInput } from "@/components/ui/SearchInput";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useToast } from "@/lib/hooks/use-toast";
import type { CardAttention } from "@/lib/storyboard/attention";
import { BOARD_FILTER_KEYS, boardFilterOptions, cardMatchesFilters, compareCards, moveCheck, NO_JIRA, rankPlan, type BoardCard, type BoardFilters } from "@/lib/storyboard/notes-board-shared";
import { BoardColumn, type ColumnDnd } from "./BoardColumn";
import { MOVE_HINT_ID, statusLine } from "./NoteCard";
import { ModelTierPicker } from "./ModelTierPicker";
import { rankBetween } from "@shared/task-note/rank.ts";
import { createPr, recoverCardFailure, clearRun, createCardNote, retryAuto, retryCard, setCardRank, setCardStatus, setUiOverride, startAuto, type ActionResult } from "./board-actions";
import { OrchestratorStatus } from "./OrchestratorStatus";
import { CardMenu, type CardMenuActions } from "./CardMenu";
import { TaskDetailProvider, useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { useContextMenu } from "@/components/shell/ContextMenu";
import { InboxToggle, WorkflowInboxPanel } from "@/components/storyboard/WorkflowInboxPanel";
import { useTaskCompletion } from "@/components/storyboard/useTaskCompletion";
import { workSummary } from "@/lib/storyboard/work-summary";
import { matchesCardQuery, storyboardUrl, storyboardView, workFilters } from "@/lib/storyboard/view-state";
import { useLive } from "@/lib/hooks/use-fetch";
import { StoryboardCapture } from "@/components/storyboard/StoryboardCapture";
import { requestStartOnAuto } from "@/lib/storyboard/start-on-auto-request";
import { PrReviewsColumn } from "./PrReviewsColumn";
import { reviewedPrs, type ReviewNoteSummary } from "@/lib/storyboard/reviewed-prs";
import { useProfileWork } from "@/lib/storyboard/use-profile-work";
import { homeWorkKey, homeWorkSummary } from "@/lib/storyboard/home-summary";
import { WorkSummaryCard } from "@/components/storyboard/WorkSummaryCard";
import { RefreshUpdated } from "@/components/storyboard/RefreshUpdated";
import { WorkCost } from "@/components/storyboard/WorkCost";
import styles from "./storyboard.module.css";

const ALL = "";


/**
 * Storyboard: a view over task notes. Columns are note statuses; each card is a
 * task and its note, so the board and the notes cannot drift. Nothing is stored
 * here. See lib/storyboard/notes-board.ts for the decisions (task-only cards,
 * screenshot priority, no Evidence tab).
 */
export default function StoryboardClient() {
  return <TaskDetailProvider><StoryboardBoard /></TaskDetailProvider>;
}

function StoryboardBoard() {
  const detail = useTaskDetail();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const view = storyboardView();
  const showAllDone = params.get("done") === "all";
  const focusedTask = params.get("task");
  const { board, inbox, prs, owned, profileId, profile } = useProfileWork({ allDone: showAllDone, includePrs: true });
  const focusedGroup = params.get("attention") === "review-requested" ? "review-requested" : params.get("attention") === "blocked" ? "blocked" : null;
  const needsYouOnly = params.get("attention") === "needs-you";
  const queue = params.get("queue") === "running" ? "running" : params.get("queue") === "next" ? "next" : null;
  const complete = useTaskCompletion(profileId);

  const urlQuery = params.get("q") ?? "";
  const [search, setSearch] = useState({ source: urlQuery, value: urlQuery });
  const query = search.source === urlQuery ? search.value : urlQuery;
  const date = params.get("date") ?? "";
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskNoteStatus | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [peeked, setPeeked] = useState<TaskNoteStatus | null>(null);
  const menu = useContextMenu<string>();
  /** The card whose menu is (or was last) open; its menu stays mounted so a dialog it opened survives the menu closing. */
  const [menuCardId, setMenuCardId] = useState<string | null>(null);
  const settingsRef = useRef<HTMLDetailsElement>(null);

  // Model pills in task notes link to ?settings=model-tiers: open Board settings at the tier picker.
  const wantsSettings = params.get("settings") === "model-tiers";
  useEffect(() => {
    if (!wantsSettings || !settingsRef.current) return;
    settingsRef.current.open = true;
    settingsRef.current.querySelector<HTMLElement>("[aria-label='Model tiers'] select")?.focus();
  }, [wantsSettings]);

  // Board settings floats over the board, so Escape and a click elsewhere close it.
  useEffect(() => {
    const panel = settingsRef.current;
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !panel.open) return;
      panel.open = false;
      panel.querySelector("summary")?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (panel.open && event.target instanceof Node && !panel.contains(event.target)) panel.open = false;
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const data = board.data;
  const now = data ? Date.parse(data.generatedAt) : 0;
  const summary = useMemo(() => workSummary(data?.cards ?? [], inbox.data?.items ?? [], now), [data?.cards, inbox.data?.items, now]);
  const home = useMemo(() => homeWorkSummary(data?.cards ?? [], inbox.data?.items ?? [], prs.data?.reviews ?? [], now, prs.data?.authored, owned.data?.repos.map((repo) => repo.fullName), prs.data?.feedbackPrs), [data?.cards, inbox.data?.items, prs.data, now, owned.data]);
  const groupIds = useMemo(() => focusedGroup ? new Set(home[focusedGroup].map(({ card }) => card.taskId)) : null, [home, focusedGroup]);
  const queueIds = useMemo(() => queue ? new Set(home[queue].map(({ card }) => card.taskId)) : null, [home, queue]);
  const reviewNotes = useLive<{ notes: ReviewNoteSummary[] }>(view === "board" ? "/api/storyboard/pr-review-notes" : null, { refreshInterval: 60_000 });
  const boardTaskIds = useMemo(() => new Set((data?.cards ?? []).map((card) => card.taskId)), [data?.cards]);
  const reviewedPeerPrs = useMemo(() => reviewedPrs(prs.data?.reviews ?? [], reviewNotes.data?.notes ?? []), [prs.data?.reviews, reviewNotes.data?.notes]);
  const peerReviews = useMemo(() => home["needs-you"].filter((work) => work.kind === "pr"), [home]);
  const needsYouCount = summary.needsYou.length + peerReviews.length;
  const workflows = summary.workflows;
  const attentionIds = useMemo(() => new Set(summary.needsYou.map(({ card }) => card.taskId)), [summary.needsYou]);
  const focusedCard = focusedTask ? data?.cards.find((card) => card.taskId === focusedTask) : undefined;
  const focusedId = focusedCard?.taskId;
  // Keyed on the id, not the card: every poll returns fresh card objects, and re-scrolling on those dragged the page back every 15s.
  useEffect(() => {
    if (focusedId) document.getElementById(`card-${focusedId}`)?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [focusedId]);

  // Filters live in the URL so a filtered board can be shared or bookmarked.
  const filterKey = [...BOARD_FILTER_KEYS, "parent"].map((key) => params.get(key) ?? "").join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the filter values, not the params object
  const filters: BoardFilters = useMemo(() => workFilters(params), [filterKey]);
  const options = useMemo(() => boardFilterOptions(data?.cards ?? []), [data?.cards]);
  const visible = useMemo(
    () => {
      const cards = (data?.cards ?? []).filter((card) => matchesCardQuery(card, query) && cardMatchesFilters(card, filters) && (!date || card.date === date) && (!needsYouOnly || attentionIds.has(card.taskId)) && (!queueIds || queueIds.has(card.taskId)) && (!groupIds || groupIds.has(card.taskId))).sort((left, right) => queue === "next" ? compareCards({ ...left, rank: left.rank ?? left.task?.rank }, { ...right, rank: right.rank ?? right.task?.rank }) : compareCards(left, right));
      if (!needsYouOnly) return cards;
      const order = new Map(summary.needsYou.map(({ card }, index) => [card.taskId, index]));
      return cards.sort((left, right) => (order.get(left.taskId) ?? 0) - (order.get(right.taskId) ?? 0));
    },
    [data?.cards, query, filters, date, needsYouOnly, attentionIds, summary.needsYou, queueIds, queue, groupIds],
  );
  const visiblePeerReviews = needsYouOnly ? peerReviews.filter(({ pr }) => !date && !filters.tag && !filters.jira && !filters.parentJira && (!filters.repo || pr.repo.toLowerCase() === filters.repo.toLowerCase() || pr.repo.toLowerCase().endsWith(`/${filters.repo.toLowerCase()}`)) && query.toLowerCase().split(/\s+/).every((word) => `${pr.title} ${pr.repo} #${pr.number} ${pr.author?.login ?? ""}`.toLowerCase().includes(word))) : [];
  const activeFilters = Object.keys(filters).length;
  const filtering = Boolean(query || date || queue) || activeFilters > 0 || needsYouOnly || !!focusedGroup;

  const run = useCallback(async (card: BoardCard, work: () => Promise<ActionResult>, success: string, optimistic?: (cards: BoardCard[]) => BoardCard[]) => {
    if (inFlight.current.has(card.taskId)) return false;
    inFlight.current.add(card.taskId);
    const cardElement = () => document.getElementById(`card-${card.taskId}`);
    // The card's controls are disabled while it works and it can re-mount in another column, which drops keyboard focus to the page.
    const hadFocus = cardElement()?.contains(document.activeElement) ?? false;
    setBusy((current) => new Set(current).add(card.taskId));
    const before = board.data;
    if (optimistic) void board.mutate((current) => current && { ...current, cards: optimistic(current.cards) }, { revalidate: false });
    try {
      const result = await work();
      if (result.ok) {
        if (result.warning) toast.info(result.warning);
        else if (success) toast.success(success);
      } else {
        if (optimistic && before) await board.mutate(before, { revalidate: false });
        toast.error(result.error ?? "That didn’t work.");
      }
      const refreshed = await board.mutate();
      const destination = refreshed?.cards.find((item) => item.taskId === card.taskId);
      if (destination && destination.status !== card.status) setExpanded((current) => ({ ...current, [destination.status]: true }));
      if (hadFocus) requestAnimationFrame(() => {
        if (!new URLSearchParams(window.location.search).has("task")) cardElement()?.focus();
      });
      return result.ok;
    } catch {
      toast.error("Couldn't confirm the update. Refresh before retrying.");
      return false;
    } finally {
      inFlight.current.delete(card.taskId);
      setBusy((current) => {
        const next = new Set(current);
        next.delete(card.taskId);
        return next;
      });
    }
  }, [board, toast]);

  const focusTask = useCallback((taskId: string) => {
    detail?.openTask(taskId);
  }, [detail]);

  /** Drag, drop or Alt+arrow: writes the note's status, the same call as the note's own status picker. */
  const move = useCallback((card: BoardCard, status: TaskNoteStatus) => {
    const check = moveCheck(card, status);
    if (!check.ok) {
      if (status !== card.status) toast.info(check.reason);
      return;
    }
    // A column the user collapsed would swallow the card they just moved, and its keyboard focus with it.
    setExpanded((current) => ({ ...current, [status]: true }));
    void run(
      card,
      () => setCardStatus(card, status, profileId),
      `Moved to ${TASK_NOTE_STATUS_LABEL[status]}.`,
      (cards) => cards.map((item) => (item.taskId === card.taskId ? { ...item, status, statusSetAt: new Date().toISOString(), attention: null } : item)),
    );
  }, [run, toast, profileId]);

  /** Drag within a column or Alt+Up/Down: writes the card's rank (and, the first time, ranks for never-ranked cards above it). */
  const reorder = useCallback((card: BoardCard, index: number) => {
    const column = visible.filter((item) => item.status === card.status);
    const plan = rankPlan(column, card, index, rankBetween);
    if (plan.length === 0) return;
    const ranks = new Map(plan.map((entry) => [entry.taskId, entry.rank]));
    const byId = new Map(column.map((item) => [item.taskId, item]));
    void run(
      card,
      async () => {
        // Neighbours first, the moved card last, so a failure part-way leaves the card where it was.
        for (const entry of [...plan.slice(0, -1), plan.at(-1)!]) {
          const result = await setCardRank(byId.get(entry.taskId) ?? card, entry.rank);
          if (!result.ok) return result;
        }
        return { ok: true };
      },
      "",
      (cards) => cards.map((item) => (ranks.has(item.taskId) ? { ...item, rank: ranks.get(item.taskId) } : item)).sort(compareCards),
    );
  }, [visible, run]);

  const columnOrder = useMemo(() => (data?.columns ?? []).map((column) => column.status), [data?.columns]);
  const endDrag = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
    setDropIndex(null);
    setPeeked(null);
  }, []);

  const handlers = useMemo(() => ({
    profile: profileId,
    onStep: (card: BoardCard, direction: -1 | 1) => {
      const target = columnOrder[columnOrder.indexOf(card.status) + direction];
      if (target) move(card, target);
    },
    onReorder: (card: BoardCard, direction: -1 | 1) => {
      const column = visible.filter((item) => item.status === card.status);
      const at = column.findIndex((item) => item.taskId === card.taskId) + direction;
      if (at < 0 || at >= column.length) return;
      reorder(card, at);
    },
    onDragStart: (card: BoardCard) => setDraggingId(card.taskId),
    onDragEnd: endDrag,
    onCreateNote: (card: BoardCard) => void run(card, () => createCardNote(card), "Note created."),
    onAttention: (card: BoardCard, attention: CardAttention) => {
      focusTask(card.taskId);
      const { action } = attention;
      if (card.failure && (action.kind === "retry" || action.kind === "auto-retry")) void run(card, () => recoverCardFailure(card, "retry", profileId), "Retrying failed step.");
      else if (action.kind === "retry") void run(card, () => retryCard(card, profileId), "Agent restarted.");
      else if (action.kind === "auto-retry") void run(card, () => retryAuto(action.taskId, profileId), action.label === "Retry" ? "Retrying on auto." : "One more fix round.");
      else if (action.kind === "clear") void run(card, () => clearRun(action.taskId, action.runId, profileId), "Idle run cleared.");
    },
    // Focus the card so the header shows its progress (and the repo picker, if auto mode needs one).
    onStartAuto: (card: BoardCard, pauseAfterPlan?: boolean) => {
      // The plain Start on auto opens the launch sheet (Run on auto checked); only an explicit "no plan review" start goes straight through.
      if (pauseAfterPlan !== false && requestStartOnAuto(card)) return;
      focusTask(card.taskId);
      void run(card, () => startAuto(card, { pauseAfterPlan: pauseAfterPlan ?? true }, profileId), "On auto.");
    },
    onCreatePr: (card: BoardCard) => void run(card, () => createPr(card, profileId), "Creating the draft PR."),
    onApprovePlan: (card: BoardCard) => void run(card, () => decidePlan(card, "approve", profileId), "Plan approved. Continuing on Auto."),
    onComplete: (card: BoardCard) => {
      void complete(card).then((result) => {
        if (result.ok) setExpanded((current) => ({ ...current, done: true }));
      });
    },
    onUiToggle: (card: BoardCard, ui: boolean | null) =>
      void run(card, () => setUiOverride(card.taskId, ui), ui === null ? "Back to detected." : ui ? "Marked as a UI change." : "Marked as not a UI change."),
    onMenu: (card: BoardCard, x: number, y: number, host: HTMLElement) => {
      if (!card.task) return;
      setMenuCardId(card.taskId);
      menu.openAtPoint(x, y, card.taskId, host);
    },
    onOpenNote: (card: BoardCard) => {
      detail?.openTask(card.taskId);
    },
    detailHref: (card: BoardCard) => detail?.hrefForTask(card.taskId) ?? `/storyboard?task=${encodeURIComponent(card.taskId)}`,
  }), [run, move, reorder, visible, columnOrder, endDrag, focusTask, menu, complete, detail, profileId]);

  const menuCard = menuCardId ? data?.cards.find((card) => card.taskId === menuCardId) ?? null : null;
  const menuColumn = menuCard ? visible.filter((card) => card.status === menuCard.status) : [];
  const menuActions: CardMenuActions = useMemo(() => ({
    move,
    reorder: (card, direction) => handlers.onReorder(card, direction),
    attention: (card, attention) => handlers.onAttention(card, attention),
    complete: (card) => handlers.onComplete(card),
    openNote: (card) => detail?.openTask(card.taskId, "note"),
    run: (card, work, success) => void run(card, work, success),
  }), [move, handlers, run, detail]);

  const groupedIds = new Set(home["review-requested"].map((work) => work.card.taskId));
  const stageVisible = filtering ? visible : visible.filter((card) => !groupedIds.has(card.taskId));
  const dragging = draggingId ? data?.cards.find((card) => card.taskId === draggingId) ?? null : null;
  const dnd: ColumnDnd = {
    dragging,
    target: dropTarget,
    index: dropIndex,
    over: (status, index) => {
      setDropTarget(status);
      setDropIndex(index);
    },
    leave: (status) => setDropTarget((current) => (current === status ? null : current)),
    drop: (status, index) => {
      if (dragging && dragging.status === status) {
        if (index !== null) reorder(dragging, index);
      } else if (dragging) move(dragging, status);
      endDrag();
    },
    peek: setPeeked,
  };

  function setParams(changes: Record<string, string | null>) {
    router.replace(storyboardUrl(pathname, params.toString(), changes, window.location.hash), { scroll: false });
  }
  const setParam = (key: string, value: string | null) => setParams({ [key]: value });
  const clearFilters = () => {
    setSearch({ source: urlQuery, value: "" });
    setParams(Object.fromEntries([...BOARD_FILTER_KEYS, "parent", "attention", "queue", "q", "date"].map((key) => [key, null])));
  };
  const jiraValue = filters.parentJira ? `parent:${filters.parentJira}` : filters.jira === NO_JIRA ? NO_JIRA : filters.jira ? `ticket:${filters.jira}` : ALL;

  const toolbar = (
    <div className={styles.toolbar}>
      <StoryboardCapture empty={!focusedTask && data?.cards.length === 0} />
      <div className={styles.search}>
        <SearchInput value={query} onChange={(value) => { setSearch({ source: urlQuery, value }); setParam("q", value || null); }} placeholder="Search title, tag, repo or summary" wrapperClassName={styles.searchWrap} />
      </div>
      <button type="button" className="btn btn-ghost" aria-pressed={focusedGroup === "blocked"} onClick={() => setParams({ attention: focusedGroup === "blocked" ? null : "blocked", queue: null })}>Blocked{data ? ` (${home.blocked.length})` : ""}</button>
      {needsYouOnly ? <button type="button" className="btn btn-ghost" aria-pressed onClick={() => setParam("attention", null)}>Needs you ({needsYouCount})</button> : null}
      {queue ? <span className="badge badge-muted">{queue === "running" ? "Running" : "Next"}</span> : null}
      {/* One menu for tags and repos, one for Jira; the search box covers text. */}
      {options.tags.length + options.repos.length > 0 || filters.tag || filters.repo ? (
        <label className={styles.field}>
          <span>Show</span>
          <select
            className="input"
            value={filters.tag ? `tag:${filters.tag}` : filters.repo ? `repo:${filters.repo}` : ALL}
            onChange={(event) => {
              const [kind, ...rest] = event.target.value.split(":");
              const value = rest.join(":");
              setParams({ tag: kind === "tag" ? value : null, repo: kind === "repo" ? value : null });
            }}
          >
            <option value={ALL}>All tasks</option>
            {options.tags.length > 0 ? <optgroup label="Tags">{options.tags.map((item) => <option key={item} value={`tag:${item}`}>#{item}</option>)}</optgroup> : null}
            {options.repos.length > 0 ? <optgroup label="Repos">{options.repos.map((item) => <option key={item} value={`repo:${item}`}>{item}</option>)}</optgroup> : null}
            {filters.tag && !options.tags.includes(filters.tag) ? <option value={`tag:${filters.tag}`}>#{filters.tag}</option> : null}
            {filters.repo && !options.repos.includes(filters.repo) ? <option value={`repo:${filters.repo}`}>{filters.repo}</option> : null}
          </select>
        </label>
      ) : null}
      {options.jira.length + options.parents.length > 0 || filters.jira || filters.parentJira ? (
        <label className={styles.field}>
          <span>Jira</span>
          <select
            className="input"
            value={jiraValue}
            onChange={(event) => {
              const value = event.target.value;
              const [kind, ...rest] = value.split(":");
              const key = rest.join(":");
              setParams({ parent: null, parentJira: kind === "parent" ? key : null, jira: value === NO_JIRA ? NO_JIRA : kind === "ticket" ? key : null });
            }}
          >
            <option value={ALL}>Any ticket</option>
            {options.noJira || filters.jira === NO_JIRA ? <option value={NO_JIRA}>No Jira</option> : null}
            {options.parents.length > 0 ? <optgroup label="Parent (epic)">{options.parents.map((key) => <option key={key} value={`parent:${key}`}>{key} and children</option>)}</optgroup> : null}
            {options.jira.length > 0 ? <optgroup label="Tickets">{options.jira.map((key) => <option key={key} value={`ticket:${key}`}>{key}</option>)}</optgroup> : null}
            {/* A shared link can name a ticket this board doesn't show (yet); keep the picker honest about the filter. */}
            {filters.parentJira && !options.parents.includes(filters.parentJira) ? <option value={jiraValue}>{filters.parentJira} and children</option> : null}
            {filters.jira && filters.jira !== NO_JIRA && !options.jira.includes(filters.jira) ? <option value={jiraValue}>{filters.jira}</option> : null}
          </select>
        </label>
      ) : null}
      {filtering ? <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear filters</button> : null}
      {date ? <label className={styles.field}><span>Date</span><input type="date" className="input" value={date} onChange={(event) => setParam("date", event.target.value || null)} /></label> : null}
      <details className={styles.boardSettings} ref={settingsRef}>
        <summary className="btn btn-ghost"><SlidersHorizontal size={14} aria-hidden />Settings<ChevronDown size={14} aria-hidden /></summary>
        <div className={styles.settingsPanel}>
          <label className={styles.check}>
            <input type="checkbox" checked={showAllDone} onChange={(event) => setParam("done", event.target.checked ? "all" : null)} />
            <span>Show older done cards</span>
          </label>
          <ModelTierPicker />
        </div>
      </details>
    </div>
  );

  if (profile.error || (profileId && params.get("profile") && params.get("profile") !== profileId)) return <div className="page-wrapper"><PageHeader title="Storyboard" /><p role="alert" className="tone-panel tone-panel--warning">{profile.error ? "Couldn't confirm the active task profile." : `This view belongs to ${params.get("profile")}, but the active profile is ${profileId}.`}</p><button type="button" className="btn btn-ghost" onClick={() => { setParam("profile", null); void profile.mutate(); }}>Show active profile</button></div>;

  return (
    <div className={"page-wrapper " + styles.page}>
      <PageHeader
        title="Storyboard"
        subtitle="Capture, organise and follow your work in one place."
        actions={<div className={styles.headerActions}>
          <OrchestratorStatus knownTaskIds={boardTaskIds} ticket={focusedTask ?? ""} progress={focusedCard?.auto ? statusLine(focusedCard, now) : undefined} />
          <InboxToggle open={params.get("inbox") === "1"} onToggle={() => setParam("inbox", params.get("inbox") === "1" ? null : "1")} />
        </div>}
      />
      {params.get("inbox") === "1" ? <WorkflowInboxPanel onClose={() => setParam("inbox", null)} onOpenCard={focusTask} /> : null}
      {toolbar}
      {inbox.error ? <FetchError bare message="Couldn't refresh workflow decisions. Needs you and Updates may be incomplete." onRetry={() => void inbox.mutate()} /> : null}
      {needsYouOnly && (prs.error || prs.data?.stale) ? <FetchError bare message="GitHub unavailable. Last-known review requests are shown." onRetry={() => void prs.mutate()} /> : null}
      {view === "board" && !needsYouOnly && !filtering && (prs.error || prs.data?.stale || reviewNotes.error) ? <FetchError bare message="Couldn’t refresh PR reviews. The review column may be incomplete." onRetry={() => { void prs.mutate(); void reviewNotes.mutate(); }} /> : null}
      {needsYouOnly && owned.error ? <FetchError bare message="Owned repositories unavailable. Review totals are unavailable." onRetry={() => void owned.mutate()} /> : null}
      {needsYouOnly && visiblePeerReviews.length > 0 ? <section aria-label="Pull requests needing you">{visiblePeerReviews.map((work) => <WorkSummaryCard key={homeWorkKey(work)} work={work} profile={profileId} onRefresh={() => void prs.mutate()} />)}</section> : null}
      {board.error && !data ? (
        <FetchError message={board.error.message} onRetry={() => void board.mutate()} />
      ) : !data ? (
        <div role="status" aria-busy="true" aria-label="Loading board">
          <SkeletonRows count={4} height={52} variant="list" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><WorkCost cost={data.cost} /><RefreshUpdated at={data.generatedAt} onRefresh={async () => { await Promise.all([board.mutate(), inbox.mutate(), prs.mutate(), owned.mutate()]); }} /></div>
          {board.error ? <p role="alert" className="tone-panel tone-panel--warning-banner">Couldn’t refresh ({board.error.message}). Showing the board as of {new Date(data.generatedAt).toLocaleTimeString("en-GB")}. <button type="button" className="btn btn-ghost" onClick={() => void board.mutate()}>Retry</button></p> : null}
          {needsYouOnly && visible.length + visiblePeerReviews.length < needsYouCount ? <p className={styles.muted}>{needsYouCount - visible.length - visiblePeerReviews.length} tasks needing you are hidden by other filters. <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear filters</button></p> : null}
          {data.errors.length > 0 ? <details className="tone-panel tone-panel--warning"><summary>{data.errors.length} source{data.errors.length === 1 ? "" : "s"} could not be read — those cards are missing, not empty</summary><ul className={styles.notes}>{data.errors.map((error) => <li key={error}>{error}</li>)}</ul></details> : null}
          {focusedTask && !focusedId ? (
            <p role="status" className="tone-panel tone-panel--warning-banner">
              That task isn’t on the board{showAllDone ? "." : ", most likely because it finished more than 14 days ago."}{" "}
              {!showAllDone ? <button type="button" className="btn btn-ghost" onClick={() => setParam("done", "all")}>Show older done</button> : null}
            </p>
          ) : null}
          {data.cards.length === 0 && visiblePeerReviews.length === 0 ? (
            <EmptyState title="No tasks yet" subtitle="Capture an idea above. It lands in To do without starting an agent." action={<button type="button" className="btn btn-ghost" onClick={() => document.getElementById("storyboard-capture")?.focus()}>Capture an idea</button>} />
          ) : (
            <>
              {filtering && visible.length === 0 && visiblePeerReviews.length === 0 ? <p className={styles.muted}>No card matches those filters.</p> : null}
              {view === "board" ? <p id={MOVE_HINT_ID} className="sr-only">Drag to another column to change the note’s status, or press Alt+Left or Alt+Right. Drag up or down, or press Alt+Up or Alt+Down, to reorder within a column. Shift+F10 opens the card’s menu.</p> : null}
              {focusedGroup ? <section aria-label={focusedGroup === "blocked" ? "Blocked" : "Review requested"}><h2 className="text-sm font-semibold mb-3">{focusedGroup === "blocked" ? "Blocked · action needed" : "Review requested"}</h2>{visible.map((card) => <WorkSummaryCard key={card.taskId} work={home[focusedGroup].find((item) => item.card.taskId === card.taskId)!} profile={profileId} onRefresh={() => { void board.mutate(); void inbox.mutate(); }} />)}</section> : <div className={styles.board}>
                {data.columns.map((column) => {
                  const cards = stageVisible.filter((card) => card.status === column.status);
                  const collapsed = peeked === column.status ? false : expanded[column.status] === undefined ? cards.length === 0 || column.status === "done" : !expanded[column.status];
                  return (
                    <BoardColumn
                      key={column.status}
                      column={column.status === "needs-you" ? { ...column, label: "Waiting for you" } : column}
                      cards={cards}
                      collapsed={collapsed}
                      onToggle={() => setExpanded((current) => ({ ...current, [column.status]: collapsed }))}
                      focusedTask={focusedTask}
                      busy={busy}
                      handlers={handlers}
                      dnd={dnd}
                      workflows={workflows}
                      now={now}
                    />
                  );
                })}
                {!filtering && reviewedPeerPrs.length > 0 ? <PrReviewsColumn items={reviewedPeerPrs} collapsed={expanded["pr-reviews"] === undefined ? false : !expanded["pr-reviews"]} onToggle={() => setExpanded((current) => ({ ...current, "pr-reviews": expanded["pr-reviews"] === undefined ? false : !expanded["pr-reviews"] }))} /> : null}
              </div>}
              {view === "board" && !focusedGroup && menuCard?.task ? (
                <CardMenu
                  key={menuCard.taskId}
                  card={menuCard}
                  task={menuCard.task}
                  open={menu.target === menuCard.taskId}
                  position={menu.position}
                  onClose={menu.close}
                  columns={columnOrder}
                  place={{ index: menuColumn.findIndex((card) => card.taskId === menuCard.taskId), count: menuColumn.length }}
                  actions={menuActions}
                  busy={busy.has(menuCard.taskId)}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
