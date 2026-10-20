/** Client-safe types for the notes board (no fs). The board owns no state; every field is read from a task, its note, or a run. */
import { TASK_NOTE_STATUSES, TASK_NOTE_STATUS_LABEL, type TaskNoteLink, type TaskNoteStatus } from "@shared/task-note/meta.ts";
import type { JevInfo } from "@/lib/qa/jev-summary";
import type { TaskPrState } from "@/lib/tasks/task-agent-runs";
import type { Task } from "@/lib/tasks/types";
import type { CardAttention } from "./attention";
import type { ExecutionStep, OrchestrationStatus } from "./types";
import type { ModelTier } from "./model-tiers-shared";

export function taskAttentionSuppressed(card: Pick<BoardCard, "status" | "statusSetAt">): boolean {
  return card.status === "done" || (card.status === "todo" && !!card.statusSetAt);
}

export interface BoardColumn {
  status: TaskNoteStatus;
  label: string;
  count: number;
}

/** One agent run on the card's log: what step it was, the tier and model it ran on, and what it cost when known. */
export interface BoardStep {
  runId: string;
  role: string;
  status: string;
  tier?: string;
  provider?: string;
  model?: string;
  /** Reported by the agent (Paseo); approximate. */
  costUsd?: number;
  tokens?: number;
  /** Auto mode's name for the run ("Fix 1", "Draft PR"), when auto mode dispatched it. */
  label?: string;
  /** Why auto mode picked this tier (escalated after a failure, large diff, trivial step). */
  tierReason?: string;
}

/** Auto mode on the card: where it is, and what it is waiting for. */
export interface BoardAuto {
  pauseAfterPlan?: boolean;
  planRunId?: string;
  updatedAt?: string;
  status?: OrchestrationStatus;
  phase: string;
  label: string;
  round: number;
  maxRounds: number;
  waiting?: { kind: "questions" | "failure" | "cap" | "queued" | "plan-approval"; reason: string };
  /** Effective answer and where it came from; `override` is the card toggle. */
  ui?: { value: boolean; detected: boolean; reason: string; override?: boolean };
  /** Jev had nothing to point at: the card shows a "No preview" badge instead of blocking. */
  noPreview?: string;
  /** DevHub is starting the repo's preview for Jev. */
  previewStarting?: string;
  previewUrl?: string;
  qaSkipped?: string;
}

export interface BoardRun {
  updatedAt?: string;
  runId: string;
  status: string;
  role?: string;
  startedAt: string;
}

/** One image in a card's viewer. */
export interface BoardImage {
  url: string;
  caption?: string;
  name?: string;
  source: "jev" | "note";
}

export interface BoardFailure {
  key: string;
  summary: string;
  runId?: string;
  cleared?: boolean;
}

export interface BoardCard {
  finishedFeedback?: import("@/lib/github/finished-task-feedback").FinishedTaskFeedback;
  statusUpdate?: import("@shared/task-note/status-update.ts").TaskStatusUpdate;
  latestScreenshot?: BoardImage;
  failure?: BoardFailure;
  review?: { gist: string; notes: string; runId: string };
  costUsd?: number;
  /** All priced/token-reporting runs, including runs older than the four-step preview. */
  usage?: BoardStep[];
  taskId: string;
  /** The task itself, for the shared task menu (the same menu as the Today's-tasks row). */
  task?: Task;
  title: string;
  /** Column: Done when the task is done, else the note's status, else what its orchestration and runs say (To do when nothing does). */
  status: TaskNoteStatus;
  statusSetAt?: string;
  /** The column the orchestrator and agent runs give it, when they give one. It only shows when the note says todo or nothing. */
  autoStatus?: TaskNoteStatus;
  /** An unrecognised hand-written note status; the card sits in To do and says so. */
  unknownStatus?: string;
  taskDone: boolean;
  /** Task day (YYYY-MM-DD): the target when a missing note is created. */
  date: string;
  /** Repo-relative note path (no extension), or null when the task has no note yet. */
  notePath: string | null;
  /** `/notes/<notePath>`, or null for a task-only card. */
  noteHref: string | null;
  tags: string[];
  links: TaskNoteLink[];
  models: string[];
  repo?: string;
  /** The orchestrator has an open repo question. Only this card shows Choose repo; any other orchestrator wait does not. */
  waitingOnRepo?: boolean;
  /** Position in its column from the note (fractional rank); unranked cards follow the ranked ones. */
  rank?: string;
  /** Jira keys on the card, the task's own first. */
  jira?: string[];
  /** The primary ticket's parent (epic), from the Jira tickets DevHub last fetched; absent when unknown. */
  parentJira?: string;
  summary: string[];
  counts: { openQuestions: number; openBugs: number; /** Open bugs with severity "blocker". */ blockerBugs: number; decisions: number };
  screenshot: { url: string; source: "jev" | "note"; caption?: string } | null;
  /** Every image for the card's viewer, newest first; the first is the thumbnail. */
  images: BoardImage[];
  jev: JevInfo | null;
  /** Tiers chosen when the task was started on auto, per step. */
  tiers: Array<{ step: ExecutionStep; tier: ModelTier; label: string; active: boolean }> | null;
  run: BoardRun | null;
  /** Newest agent runs first (at most four), each with its tier and cost. */
  steps: BoardStep[];
  /** Auto mode, when the task runs on it. */
  auto?: BoardAuto;
  prUrl?: string;
  /** What the PR watcher last saw, when the PR came from an agent run. Merged or closed is not "awaiting review". */
  prState?: TaskPrState;
  updatedAt: string;
  /** When an agent last edited the note through task_note_update, and with which op. */
  agentNoteUpdate?: { at: string; op: string };
  attention: CardAttention | null;
}

export interface NotesBoard {
  cost?: { todayUsd: number; weekUsd: number };
  columns: BoardColumn[];
  cards: BoardCard[];
  generatedAt: string;
  /** Done cards older than the window; `?done=all` includes them. */
  hiddenDone: number;
  /** Sources that could not be read; their cards are missing, not empty. */
  errors: string[];
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

interface MoveWork {
  status: TaskNoteStatus;
  run?: { status: string } | null;
  steps?: Array<{ status: string }>;
  auto?: { status?: string };
}

export function isBackwardMove(from: TaskNoteStatus, to: TaskNoteStatus): boolean {
  return TASK_NOTE_STATUSES.indexOf(to) < TASK_NOTE_STATUSES.indexOf(from);
}

export function moveRequiresConfirmation(card: MoveWork, target: TaskNoteStatus): boolean {
  const active = (status?: string) => status === "queued" || status === "running" || status === "starting";
  return isBackwardMove(card.status, target) && (active(card.run?.status) || active(card.auto?.status) || !!card.steps?.some((step) => active(step.status)));
}

/**
 * Whether a card can be dragged (or Alt+arrowed) to a column. A move writes the
 * note's status, the same as the note's own status picker, so it overrides an
 * auto-mode or run-derived column, including To do. Closed tasks are reopened
 * by the move operation, which also stops live work before a backward move.
 */
export function moveCheck(card: Pick<BoardCard, "status" | "taskDone" | "autoStatus">, target: TaskNoteStatus): MoveCheck {
  if (target === card.status) return { ok: false, reason: `Already in ${TASK_NOTE_STATUS_LABEL[target]}.` };
  return { ok: true };
}

/** Board filters; every one lives in the URL (`?repo=&tag=&jira=&parentJira=`) and in `storyboard_board`. */
export interface BoardFilters {
  repo?: string;
  tag?: string;
  /** A Jira key, or NO_JIRA for cards with none. */
  jira?: string;
  /** A parent (epic) key: its child tickets, and cards linked to the parent itself. */
  parentJira?: string;
}

export const NO_JIRA = "none";
export const BOARD_FILTER_KEYS = ["repo", "tag", "jira", "parentJira"] as const;

const sameKey = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export function cardMatchesFilters(card: Pick<BoardCard, "repo" | "tags" | "jira" | "parentJira">, filters: BoardFilters): boolean {
  const jira = card.jira ?? [];
  if (filters.repo && card.repo?.toLowerCase() !== filters.repo.toLowerCase()) return false;
  if (filters.tag && !card.tags.includes(filters.tag.replace(/^#/, "").toLowerCase())) return false;
  if (filters.jira) {
    if (filters.jira === NO_JIRA ? jira.length > 0 : !jira.some((key) => sameKey(key, filters.jira!))) return false;
  }
  if (filters.parentJira) {
    const parent = filters.parentJira;
    if (!(card.parentJira && sameKey(card.parentJira, parent)) && !jira.some((key) => sameKey(key, parent))) return false;
  }
  return true;
}

/** What the filter pickers offer: only values that appear on the board. */
export function boardFilterOptions(cards: Array<Pick<BoardCard, "repo" | "tags" | "jira" | "parentJira">>): { repos: string[]; tags: string[]; jira: string[]; parents: string[]; noJira: boolean } {
  const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const parents = sorted(cards.flatMap((card) => (card.parentJira ? [card.parentJira] : [])));
  return {
    repos: sorted(cards.flatMap((card) => (card.repo ? [card.repo] : []))),
    tags: sorted(cards.flatMap((card) => card.tags)),
    jira: sorted(cards.flatMap((card) => card.jira ?? [])),
    parents,
    noJira: cards.some((card) => !card.jira?.length),
  };
}

export function filtersFromParams(params: { get(name: string): string | null }): BoardFilters {
  const out: BoardFilters = {};
  for (const key of BOARD_FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Board order: ranked cards first by rank, then cards needing attention, then the most recently updated. */
export function compareCards(a: Pick<BoardCard, "rank" | "attention" | "updatedAt">, b: Pick<BoardCard, "rank" | "attention" | "updatedAt">): number {
  if (a.rank && b.rank && a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  if (Boolean(a.rank) !== Boolean(b.rank)) return a.rank ? -1 : 1;
  return Number(Boolean(b.attention)) - Number(Boolean(a.attention)) || b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * Rank writes that put `card` at `index` among the column's other cards (`column` in board order, card
 * included). Ranked cards always sort before unranked ones, so normally only the moved card's rank
 * changes. The exception is a spot below cards that were never ranked: those above it get ranks too,
 * once, so the order sticks. Empty when the card would not move.
 */
export function rankPlan(column: Array<Pick<BoardCard, "taskId" | "rank">>, card: Pick<BoardCard, "taskId">, index: number, between: (before?: string, after?: string) => string): Array<{ taskId: string; rank: string }> {
  const from = column.findIndex((item) => item.taskId === card.taskId);
  const others = column.filter((item) => item.taskId !== card.taskId);
  const at = Math.max(0, Math.min(index, others.length));
  if (from === at && column[from]?.rank) return [];
  const rankedCount = others.findIndex((item) => !item.rank);
  const ranked = rankedCount < 0 ? others.length : rankedCount;
  if (at <= ranked) return [{ taskId: card.taskId, rank: between(others[at - 1]?.rank, others[at]?.rank) }];
  const plan: Array<{ taskId: string; rank: string }> = [];
  let previous = others[ranked - 1]?.rank;
  for (const item of [...others.slice(ranked, at), card]) {
    previous = between(previous, undefined);
    plan.push({ taskId: item.taskId, rank: previous });
  }
  return plan;
}
