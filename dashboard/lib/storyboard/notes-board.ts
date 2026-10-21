/**
 * The Storyboard is a view over task notes. Nothing here is stored: each card
 * is read from a task, its note (`task-notes/<date>-<id>`), its agent runs, its
 * orchestration record and its Jev QA runs, so board and notes cannot drift.
 *
 * Decisions (the mock's open questions, answered):
 * 1. A task without a note is a task-only card with a one-click "Create note"
 *    (the existing task-note scaffold). Nothing is created automatically, and
 *    evidence with no task is not shown.
 * 2. Screenshot priority: newest Jev QA capture (after > before), then the
 *    newest image in the note's Screenshots section, then none. No previews.
 * 3. There is no Evidence tab. A card opens its note; runs and QA links live
 *    on the card.
 * 4. Column = the note's status, with two overrides. A task ticked done in
 *    Tasks is Done (that never touches its note, so the note cannot outrank
 *    it). A note that records no status, or only the scaffold's default
 *    `todo`, takes its column from the orchestrator and the agent runs, which
 *    are the only other places progress is written.
 */
import { blocksToText } from "@shared/markdown-convert/index.ts";
import { finishedTaskFeedback, type PrFeedbackSnapshot } from "@/lib/github/finished-task-feedback";
import { readGithubPrsListCache } from "@/lib/github/prs";
import { failureSummary, oneLine } from "./work-insights";
import { readFailureAcknowledgement } from "./failure-acknowledgements";
import { readRunEvents } from "@/lib/agent-runs/run-files";
import { extractTags } from "@shared/entity-note/index.ts";
import { readAgentRun } from "@/lib/agent-runs/store";
import { readAgentNoteUpdates } from "@shared/task-note/agent-updates.ts";
import { buildTaskNoteMeta } from "@shared/task-note/index.ts";
import { isTaskNoteStatus, safeLinkHref, TASK_NOTE_STATUS_LABEL, TASK_NOTE_STATUSES, type TaskNoteStatus } from "@shared/task-note/meta.ts";
import { inlinePlainText, isTaskNotePath, readTaskNoteWithMigration, type TaskNoteView } from "@shared/task-note/sections.ts";
import { itemReadErrors, readItems } from "@shared/tasks/store.ts";
import { VAULT_PATHS } from "@shared/vault/vault-routes.ts";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { getJiraTicketsCache } from "@/lib/jira/tickets-cache";
import { getNotesDir } from "@/lib/notes/dir";
import { jevInfoByTask, type JevInfo } from "@/lib/qa/jev-summary";
import { listRuns } from "@/lib/qa/store";
import { getStorage } from "@/lib/storage-server";
import { isActiveTaskAgentRunStatus, listTaskAgentRuns, type TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import { createTaskNoteResolver } from "@/lib/tasks/task-notes";
import type { Task } from "@/lib/tasks/types";
import { cardAttention } from "./attention";
import { tierLabel, type ModelTierSettings, type TierStep } from "./model-tiers-shared";
import { compareCards, type BoardCard, type BoardImage, type NotesBoard, type BoardStep } from "./notes-board-shared";
import { listOrchestrations } from "./orchestration-store";
import { AUTO_PHASE_LABEL, summariseOrchestration, type OrchestrationSummary } from "./orchestration";
import { columnForPhase } from "./auto-phase";
import type { ExecutionStep } from "./types";

export const DONE_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_STEPS_SHOWN: ExecutionStep[] = ["plan", "implement", "verify"];

export interface NoteRead {
  notePath: string;
  /** Null when the task has no note yet, or the note could not be read (see `error`). */
  view: TaskNoteView | null;
  modified: number | null;
  error?: string;
  /** Last image John pasted anywhere in the note (outside the Screenshots section), for the card thumbnail. */
  pastedImage?: { url: string; caption?: string };
  /** Every image block in the note, in document order (the viewer shows them newest first). */
  noteImages?: Array<{ url: string; caption?: string }>;
}

/** Every image block in document order, at any depth. Pasted images live in free-form content, not the Screenshots section. */
export function imageBlocks(blocks: unknown): Array<{ url: string; caption?: string }> {
  const found: Array<{ url: string; caption?: string }> = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const block = item as { type?: unknown; props?: { url?: unknown; caption?: unknown }; children?: unknown };
      const url = block.type === "image" ? safeLinkHref(block.props?.url) : undefined;
      if (url) {
        const caption = typeof block.props?.caption === "string" && block.props.caption.trim() ? block.props.caption.trim() : undefined;
        found.push({ url, ...(caption ? { caption } : {}) });
      }
      walk(block.children);
    }
  };
  walk(blocks);
  return found;
}

/** The last image block in document order, at any depth. */
export function lastImageBlock(blocks: unknown): { url: string; caption?: string } | undefined {
  return imageBlocks(blocks).at(-1);
}

/**
 * Every image the card's viewer shows, newest first with the thumbnail first: the Jev capture, then the
 * note's Screenshots section, then images pasted anywhere else in the note. Deduped by URL.
 */
export function cardImages(screenshot: BoardCard["screenshot"], view: TaskNoteView | null, noteImages: NoteRead["noteImages"]): BoardImage[] {
  const out: BoardImage[] = [];
  const seen = new Set<string>();
  const add = (image: BoardImage) => {
    if (seen.has(image.url)) return;
    seen.add(image.url);
    out.push(image);
  };
  if (screenshot) add({ url: screenshot.url, ...(screenshot.caption ? { caption: screenshot.caption } : {}), source: screenshot.source });
  const media = (view?.media ?? []).filter((item) => item.kind === "image" && safeLinkHref(item.url));
  for (const item of [...media].reverse()) add({ url: item.url, ...(item.caption ? { caption: item.caption } : {}), ...(item.name ? { name: item.name } : {}), source: "note" });
  for (const image of [...(noteImages ?? [])].reverse()) add({ ...image, source: "note" });
  return out;
}

type BoardRunSource = Pick<TaskAgentRunRecord, "runId" | "status" | "role" | "startedAt" | "prUrl" | "prState" | "provider" | "model" | "tier"> & Partial<Pick<TaskAgentRunRecord, "updatedAt">>;

/** What an agent run cost, as its runtime reported it. */
export interface RunUsage {
  /** Lifecycle time from the run store, unaffected by task-sidecar reconciliation. */
  stateChangedAt?: number;
  error?: string;
  exitCode?: number | null;
  resultText?: string;
  reviewText?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function failureAcknowledged(saved: string | undefined, identity: unknown[]): boolean {
  if (!saved) return false;
  if (saved === JSON.stringify(identity)) return true;
  let previous: unknown;
  try { previous = JSON.parse(saved); } catch { return false; }
  // Older keys used the sidecar's update time. Keep a dismissal only when that
  // time covers this failure event and every other part of its identity matches.
  if (!Array.isArray(previous) || typeof previous[1] !== "string" || typeof identity[1] !== "number" || !(Date.parse(previous[1]) >= identity[1])) return false;
  previous[1] = identity[1];
  return JSON.stringify(previous) === JSON.stringify(identity);
}

const STEP_LOG_LIMIT = 4;

function stepLog(runs: BoardRunSource[], usageFor: ((runId: string) => RunUsage | undefined) | undefined, auto?: OrchestrationSummary["auto"], limit = STEP_LOG_LIMIT): BoardStep[] {
  return runs.slice(0, limit).map((run) => {
    const usage = usageFor?.(run.runId);
    const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    const autoRun = auto?.runs.find((entry) => entry.runId === run.runId);
    const label = autoRun ? (autoRun.phase === "fix" ? `Fix ${autoRun.round}` : autoRun.phase === "verify" ? "Review" : AUTO_PHASE_LABEL[autoRun.phase]) : undefined;
    return {
      ...(label ? { label } : {}),
      ...(autoRun?.tierReason ? { tierReason: autoRun.tierReason } : {}),
      runId: run.runId,
      role: run.role ?? "implement",
      status: run.status,
      ...(run.tier?.tier ? { tier: run.tier.tier } : {}),
      ...(run.provider ? { provider: run.provider } : {}),
      ...(run.model ? { model: run.model } : {}),
      ...(typeof usage?.costUsd === "number" && Number.isFinite(usage.costUsd) && usage.costUsd > 0 ? { costUsd: usage.costUsd } : {}),
      ...(tokens > 0 ? { tokens } : {}),
    };
  });
}

export interface BoardSources {
  feedbackPrs?: PrFeedbackSnapshot[];
  tasks: Task[];
  now: number;
  /** Null shows every done card. */
  doneWindowDays: number | null;
  noteFor: (task: Task) => NoteRead;
  /** Newest first. */
  runsFor: (taskId: string) => BoardRunSource[];
  orchestrations: Map<string, OrchestrationSummary>;
  /** Last agent edit per note path (shared/task-note/agent-updates.ts). */
  agentNoteUpdates?: Record<string, { at: string; op: string }>;
  /** A Jira key's parent (epic) key, when DevHub knows it; omitted means unknown. */
  jiraParentOf?: (key: string) => string | undefined;
  jiraStatusOf?: (key: string) => { status: string; statusCategory?: string } | undefined;
  /** Cost and tokens per agent run; omitted in tests that do not care. */
  usageFor?: (runId: string) => RunUsage | undefined;
  clearedFailureFor?: (taskId: string) => string | undefined;
  jev: Map<string, JevInfo>;
  errors: string[];
}

function cleanTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

/** Kinds a note may leave out that the task file still knows; the note wins whenever it names its own. */
const TASK_FALLBACK_LINK_KINDS = new Set(["repo", "jira"]);

export function withTaskLinks(noteLinks: BoardCard["links"] | undefined, taskLinks: BoardCard["links"] | undefined): BoardCard["links"] {
  const own = noteLinks ?? [];
  const kinds = new Set(own.map((link) => link.kind));
  const extra = (taskLinks ?? []).filter((link) => TASK_FALLBACK_LINK_KINDS.has(link.kind) && !kinds.has(link.kind));
  return extra.length ? [...own, ...extra] : own;
}

/** The task's own ticket first, then any other Jira links on the note or task. */
function jiraKeys(task: Task, links: BoardCard["links"]): string[] {
  const keys = [task.jiraKey, ...links.filter((link) => link.kind === "jira").map((link) => link.id)]
    .map((key) => key?.trim().toUpperCase())
    .filter((key): key is string => Boolean(key && key !== task.parentKey?.toUpperCase() && /^[A-Z][A-Z0-9_]*-\d+$/.test(key)));
  return [...new Set(keys)];
}

function repoLabel(links: BoardCard["links"]): string | undefined {
  const id = links.find((link) => link.kind === "repo")?.id;
  return id ? id.split("/").at(-1) : undefined;
}

function tiersFor(summary: OrchestrationSummary | undefined): BoardCard["tiers"] {
  const tiers: ModelTierSettings | undefined = summary?.tiers;
  if (!summary || !tiers) return null;
  return TIER_STEPS_SHOWN.map((step) => {
    // Verify is the code review plus Jev, and the review runs on the Review step's tier; no run ever uses the Verify step's, so showing it would say "cheap" over an Opus review.
    const tierStep: TierStep = step === "verify" ? "review" : step;
    return { step, tier: tiers.steps[tierStep], label: tierLabel(tiers, tierStep) ?? tiers.steps[tierStep], active: summary.executionStep === step };
  });
}

function noteScreenshot(view: TaskNoteView): BoardCard["screenshot"] {
  const images = view.media.filter((item) => item.kind === "image" && safeLinkHref(item.url));
  const newest = images.at(-1);
  return newest ? { url: newest.url, source: "note", ...(newest.caption ? { caption: newest.caption } : {}) } : null;
}

function orchestrationColumn(orchestration: OrchestrationSummary): TaskNoteStatus | null {
  if (orchestration.status === "ready-for-review") return "ready-for-review";
  if (orchestration.auto && (orchestration.status === "starting" || orchestration.status === "running")) return columnForPhase(orchestration.auto.phase);
  const atStep: TaskNoteStatus = orchestration.executionStep === "plan" ? "planning" : orchestration.executionStep === "draft-pr" ? "draft-pr" : "in-progress";
  switch (orchestration.status) {
    case "needs-you":
      return "needs-you";
    case "pr-created":
      return "draft-pr";
    // No run means the start never dispatched; with runs it is a step waiting on review (QA passed).
    case "paused":
      return orchestration.runCount === 0 ? "blocked" : atStep;
    case "starting":
    case "running":
      return atStep;
    default:
      return null; // Stopped and Manual: the user took over.
  }
}

/** A run counts while it is live; an open PR from the implementation means a PR is waiting for review (the column id is still draft-pr). */
function runColumn(runs: BoardRunSource[]): TaskNoteStatus | null {
  const latest = runs[0];
  if (latest && isActiveTaskAgentRunStatus(latest.status)) return latest.role === "plan" || latest.role === "discuss" ? "planning" : "in-progress";
  const draftPr = runs.some((run) => (!run.role || run.role === "implement") && run.prUrl && run.prState !== "merged" && run.prState !== "closed");
  return draftPr ? "draft-pr" : null;
}

/** Column for work the note says nothing about. The orchestrator knows the step, so it outranks a bare run. */
function derivedStatus(orchestration: OrchestrationSummary | undefined, runs: BoardRunSource[]): TaskNoteStatus | null {
  return (orchestration && orchestrationColumn(orchestration)) ?? runColumn(runs);
}

function statusFor(
  task: Task,
  view: TaskNoteView | null,
  orchestration: OrchestrationSummary | undefined,
  runs: BoardRunSource[],
  jira?: { status: string; statusCategory?: string },
): { status: TaskNoteStatus; unknownStatus?: string; autoStatus?: TaskNoteStatus } {
  const fromNote = view?.meta?.status;
  const unknownStatus = fromNote && !isTaskNoteStatus(fromNote) ? fromNote : undefined;
  const recorded = isTaskNoteStatus(fromNote) && (fromNote !== "todo" || view?.meta?.statusSetAt) ? fromNote : undefined;
  const auto = task.done ? null : derivedStatus(orchestration, runs);
  const live = runs.some((run) => isActiveTaskAgentRunStatus(run.status)) || orchestration?.status === "starting" || orchestration?.status === "running";
  let jiraDefault: TaskNoteStatus | undefined;
  if (!live && jira) {
    const jiraStatus = jira.status.trim().toLowerCase();
    if (jira.statusCategory?.trim().toLowerCase() === "done" || ["code review", "review", "in review", "qa", "done", "closed", "resolved"].includes(jiraStatus)) jiraDefault = "done";
    else if (["paused", "on hold", "open", "to do", "backlog"].includes(jiraStatus)) jiraDefault = "todo";
  }
  const status = task.done ? "done" : (recorded ?? jiraDefault ?? auto ?? "todo");
  return { status, ...(unknownStatus ? { unknownStatus } : {}), ...(auto ? { autoStatus: auto } : {}) };
}

function timeOf(value: string | undefined): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function boardAuto(auto: NonNullable<OrchestrationSummary["auto"]>, status: OrchestrationSummary["status"]): NonNullable<BoardCard["auto"]> {
  const ui = auto.ui ? { value: auto.ui.override ?? auto.ui.detected, detected: auto.ui.detected, reason: auto.ui.reason, ...(auto.ui.override !== undefined ? { override: auto.ui.override } : {}) } : undefined;
  return {
    ...(auto.pauseAfterPlan !== undefined ? { pauseAfterPlan: auto.pauseAfterPlan } : {}),
    ...(auto.planRunId ? { planRunId: auto.planRunId } : {}),
    phase: auto.phase,
    status,
    label: AUTO_PHASE_LABEL[auto.phase],
    round: auto.round,
    maxRounds: auto.maxRounds,
    ...(auto.waiting ? { waiting: auto.waiting } : {}),
    ...(ui ? { ui } : {}),
    ...(auto.preview?.state === "none" && ui?.value ? { noPreview: auto.preview.reason } : {}),
    ...(auto.preview?.state === "starting" && ui?.value ? { previewStarting: auto.preview.reason } : {}),
    ...(auto.preview?.url ? { previewUrl: auto.preview.url } : {}),
    ...(auto.qaSkipped ? { qaSkipped: auto.qaSkipped } : {}),
  };
}

export function buildNotesBoard(sources: BoardSources): NotesBoard {
  const { now } = sources;
  const cards: BoardCard[] = [];
  let hiddenDone = 0;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  const cost = { todayUsd: 0, weekUsd: 0 };
  const counted = new Set<string>();
  for (const task of sources.tasks) for (const run of sources.runsFor(task.id)) {
    if (counted.has(run.runId)) continue;
    counted.add(run.runId);
    const at = Date.parse(run.startedAt);
    if (!Number.isFinite(at) || at < week.getTime() || at > now) continue;
    const value = sources.usageFor?.(run.runId)?.costUsd;
    if (!value || !Number.isFinite(value) || value <= 0 || at > now) continue;
    if (at >= today.getTime()) cost.todayUsd += value;
    if (at >= week.getTime()) cost.weekUsd += value;
  }

  const pastDoneWindow = (finishedAt: number | null) =>
    sources.doneWindowDays !== null && finishedAt !== null && now - finishedAt > sources.doneWindowDays * DAY_MS;

  for (const task of sources.tasks) {
    // Abandoned and legacy-moved tasks are not work in flight.
    if (task.abandonedAt || (task.endDate && !task.done)) continue;
    // Old finished work goes before its note is read: there can be hundreds, and a broken one would only add noise to `errors`.
    const possibleFeedback = sources.feedbackPrs?.some((snapshot) => finishedTaskFeedback({ taskDone: task.done, task, prUrl: snapshot.url }, [snapshot]));
    if (task.done && !possibleFeedback && pastDoneWindow(timeOf(task.completedAt))) {
      hiddenDone += 1;
      continue;
    }
    const note = sources.noteFor(task);
    if (note.error) sources.errors.push(`${note.notePath}: ${note.error}`);
    const view = note.view;
    const stateTime = (run: BoardRunSource) => sources.usageFor?.(run.runId)?.stateChangedAt ?? timeOf(run.updatedAt) ?? timeOf(run.startedAt) ?? 0;
    // Repairing links or PR metadata must not make an older review the latest run.
    const runs = [...sources.runsFor(task.id)].sort((left, right) => stateTime(right) - stateTime(left));
    const orchestration = sources.orchestrations.get(task.id);
    const taskMeta = buildTaskNoteMeta({ id: task.id, text: task.text, date: task.startDate, jiraKey: task.jiraKey, related: task.links });
    const meta = view?.meta ? { ...view.meta, links: withTaskLinks(view.meta.links, taskMeta.links) } : taskMeta;
    const links = meta.links ?? [];
    const linkedJira = jiraKeys(task, links);
    const ownJira = linkedJira[0];
    const knownParent = task.parentKey ?? (ownJira ? sources.jiraParentOf?.(ownJira) : undefined);
    const parentJira = knownParent && knownParent.toUpperCase() !== ownJira ? knownParent.toUpperCase() : undefined;
    const jira = linkedJira.filter((key) => key !== parentJira);
    const { status, unknownStatus, autoStatus } = statusFor(task, view, orchestration, runs, ownJira ? sources.jiraStatusOf?.(ownJira) : undefined);

    // `completedAt` is missing on tasks finished before it was recorded; the note's last edit is the next best guess.

    // A task-only card previews the pills its note would start with. A note keeps its own pills, but the
    // task's repo and Jira fill in when the note records none: hand-written and older notes often have no
    // task-meta block at all, and without the repo the card dropped out of the repo filter.
    const title = view?.title || task.text;
    const tags = [...new Set([...(meta.tags ?? []), ...extractTags(title)].map(cleanTag))];
    const latest = runs[0];
    const jev = sources.jev.get(task.id) ?? null;
    const prLink = links.find((link) => link.kind === "pr" && safeLinkHref(link.href));
    const prRun = runs.find((run) => run.prUrl);
    const prUrl = prRun?.prUrl ?? orchestration?.prUrl ?? prLink?.href;
    const feedback = finishedTaskFeedback({ taskDone: task.done, task, prUrl, links }, sources.feedbackPrs ?? []);
    if (status === "done" && !feedback && pastDoneWindow(timeOf(task.completedAt) ?? note.modified ?? timeOf(task.createdAt))) {
      hiddenDone += 1;
      continue;
    }
    const cachedPr = sources.feedbackPrs?.find((item) => item.url.toLowerCase() === prUrl?.toLowerCase());
    const openBugs = view?.bugs.filter((bug) => bug.status === "open") ?? [];
    const summary = (view?.summary ?? []).map((nodes) => inlinePlainText(nodes).trim()).filter(Boolean).slice(0, 2).map((line) => line.slice(0, 200));

    // Jev capture, then the note's Screenshots section, then the last image pasted anywhere in the note.
    const screenshot: BoardCard["screenshot"] = jev?.screenshot ? { url: jev.screenshot.url, source: "jev" } : (view ? noteScreenshot(view) : null) ?? (note.pastedImage ? { url: note.pastedImage.url, source: "note", ...(note.pastedImage.caption ? { caption: note.pastedImage.caption } : {}) } : null);

    const card: BoardCard = {
      ...(feedback ? { finishedFeedback: feedback } : {}),
      taskId: task.id,
      task,
      title,
      status,
      ...(meta.statusSetAt ? { statusSetAt: meta.statusSetAt } : {}),
      ...(unknownStatus ? { unknownStatus } : {}),
      ...(autoStatus ? { autoStatus } : {}),
      taskDone: task.done,
      date: task.startDate,
      notePath: view ? note.notePath : null,
      noteHref: view ? VAULT_PATHS.notes.pageHref(note.notePath) : null,
      tags,
      links,
      models: meta.models ?? [],
      ...(repoLabel(links) ? { repo: repoLabel(links) } : {}),
      ...(meta.rank ? { rank: meta.rank } : {}),
      ...(jira.length ? { jira } : {}),
      ...(parentJira ? { parentJira } : {}),
      summary,
      ...(view?.statusUpdate ? { statusUpdate: view.statusUpdate } : {}),
      ...(view?.latestScreenshot && safeLinkHref(view.latestScreenshot.url) ? { latestScreenshot: { url: view.latestScreenshot.url, caption: view.latestScreenshot.caption, source: "note" as const } } : {}),
      counts: {
        openQuestions: view?.questions.filter((question) => !question.resolved).length ?? 0,
        openBugs: openBugs.length,
        blockerBugs: openBugs.filter((bug) => bug.severity === "blocker").length,
        decisions: view?.decisions.length ?? 0,
      },
      screenshot,
      images: cardImages(screenshot, view, note.noteImages),
      jev,
      tiers: tiersFor(orchestration),
      steps: stepLog(runs, sources.usageFor, orchestration?.auto),
      ...(orchestration?.waitingOnRepo && orchestration.status === "needs-you" ? { waitingOnRepo: true } : {}),
      ...(orchestration?.auto ? { auto: { ...boardAuto(orchestration.auto, orchestration.status), updatedAt: orchestration.updatedAt } } : {}),
      ...(view && sources.agentNoteUpdates?.[note.notePath] ? { agentNoteUpdate: { at: sources.agentNoteUpdates[note.notePath].at, op: sources.agentNoteUpdates[note.notePath].op } } : {}),
      run: latest ? { runId: latest.runId, status: latest.status, ...(latest.role ? { role: latest.role } : {}), startedAt: latest.startedAt, ...(latest.updatedAt ? { updatedAt: latest.updatedAt } : {}) } : null,
      ...(prUrl ? { prUrl } : {}),
      // Only a run's PR has a watched state; a link on the note or an orchestration's PR does not.
      ...(prRun?.prState ? { prState: prRun.prState } : {}),
      ...(cachedPr && ["OPEN", "CLOSED", "MERGED"].includes(cachedPr.state.toUpperCase()) ? { prState: cachedPr.state.toLowerCase() as "open" | "closed" | "merged" } : {}),
      updatedAt: new Date(note.modified ?? timeOf(task.completedAt) ?? timeOf(task.createdAt) ?? now).toISOString(),
      attention: null,
    };
    card.attention = cardAttention({ ...card, orchestratorWaiting: orchestration?.status === "needs-you", ...(orchestration?.auto?.waiting && orchestration.status === "needs-you" ? { autoWaiting: orchestration.auto.waiting } : {}) }, now);
    const usage = stepLog(runs, sources.usageFor, orchestration?.auto, Infinity).filter((step) => step.costUsd || step.tokens);
    const total = usage.reduce((sum, step) => sum + (step.costUsd ?? 0), 0);
    if (usage.length) card.usage = usage;
    if (total > 0) card.costUsd = total;
    const reviewRun = runs.find((run) => run.role === "review");
    const reviewText = reviewRun?.status === "done" ? (sources.usageFor?.(reviewRun.runId)?.reviewText || sources.usageFor?.(reviewRun.runId)?.resultText)?.trim() : undefined;
    if (reviewRun && reviewText) card.review = { gist: oneLine(reviewText), notes: reviewText, runId: reviewRun.runId };
    const stopped = orchestration?.status === "needs-you" || orchestration?.status === "paused";
    // Waiting on John's answers or a plan approval is not a failure: its reason is a prompt, and showing it as "Plan failed" put Retry where Answer belongs.
    const waitingKind = orchestration?.auto?.waiting?.kind;
    const autoFailure = stopped && waitingKind !== "plan-approval" && waitingKind !== "questions" && (waitingKind === "failure" || orchestration?.lastError);
    if (!task.done && (latest?.status === "failed" || autoFailure)) {
      const details = latest ? sources.usageFor?.(latest.runId) : undefined;
      const error = details?.error || orchestration?.lastError || (autoFailure ? orchestration?.auto?.waiting?.reason : undefined);
      const identity = [latest?.runId, details?.stateChangedAt ?? latest?.updatedAt, orchestration?.updatedAt, error, details?.exitCode];
      const key = JSON.stringify(identity);
      card.failure = { key, summary: failureSummary(error, details?.exitCode, latest?.role ?? orchestration?.auto?.phase ?? "Agent"), ...(latest ? { runId: latest.runId } : {}) };
      if (failureAcknowledged(sources.clearedFailureFor?.(task.id), identity)) {
        card.failure.cleared = true;
        card.attention = null;
        // The acknowledgement changes the work view, never the failed run or its history.
        // A To do someone chose (statusSetAt) is a deliberate move back, not a stale column; leave it there.
        const choseTodo = card.status === "todo" && !!card.statusSetAt;
        if (!choseTodo && ["needs-you", "blocked", "todo"].includes(card.status) && !card.counts.openQuestions) card.status = orchestration?.auto ? columnForPhase(orchestration.auto.phase) : latest?.role === "plan" ? "planning" : "in-progress";
      }
    }
    cards.push(card);
  }

  cards.sort(compareCards);
  return {
    columns: TASK_NOTE_STATUSES.map((status) => ({ status, label: TASK_NOTE_STATUS_LABEL[status], count: cards.filter((card) => card.status === status).length })),
    cards,
    generatedAt: new Date(now).toISOString(),
    hiddenDone,
    ...(cost.weekUsd > 0 || cost.todayUsd > 0 ? { cost } : {}),
    errors: sources.errors,
  };
}

/** The real board: every open task plus recently finished ones, read from disk. */
export function readNotesBoard(options: { doneWindowDays?: number | null; now?: number } = {}): NotesBoard {
  const errors: string[] = [];
  const tasksDir = getActiveTasksDir();
  errors.push(...itemReadErrors(tasksDir));
  const tasks = readItems(tasksDir);
  const resolveNote = createTaskNoteResolver();
  const storage = getStorage();
  const notesDir = getNotesDir();

  const noteFor = (task: Task): NoteRead => {
    const notePath = resolveNote(task, task.startDate).notePath;
    // `task.notePath` is whatever the task file says; only a task note may be read and shown as a card.
    if (!isTaskNotePath(notePath) || notePath.includes("..")) return { notePath, view: null, modified: null, error: "not a task note path" };
    try {
      const file = storage.read(notePath);
      if (!file) return { notePath, view: null, modified: null };
      if (!Array.isArray(file.content)) return { notePath, view: null, modified: file.modified, error: "not a BlockNote note" };
      const noteImages = imageBlocks(file.content);
      const pastedImage = noteImages.at(-1);
      return { notePath, view: readTaskNoteWithMigration(file.content), modified: file.modified, ...(pastedImage ? { pastedImage, noteImages } : {}) };
    } catch (error) {
      return { notePath, view: null, modified: null, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const orchestrations = new Map<string, OrchestrationSummary>();
  try {
    const listed = listOrchestrations(notesDir);
    errors.push(...listed.errors);
    for (const record of listed.records) {
      const latest = (() => { try { return listTaskAgentRuns(record.taskId, notesDir)[0]?.status; } catch { return undefined; } })();
      orchestrations.set(record.taskId, summariseOrchestration(record, latest));
    }
  } catch (error) {
    errors.push(`orchestrations: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Parents come from the Jira tickets DevHub last fetched (in memory, no network here). Unknown stays unknown.
  const jiraParents = new Map<string, string>();
  const jiraStatuses = new Map<string, { status: string; statusCategory?: string }>();
  const cachedTickets = getJiraTicketsCache()?.data;
  if (Array.isArray(cachedTickets)) {
    for (const ticket of cachedTickets as Array<{ key?: unknown; status?: unknown; statusCategory?: unknown; parent?: { key?: unknown } | null }>) {
      if (typeof ticket?.key === "string" && typeof ticket.parent?.key === "string") jiraParents.set(ticket.key.toUpperCase(), ticket.parent.key.toUpperCase());
      if (typeof ticket?.key === "string" && typeof ticket.status === "string") jiraStatuses.set(ticket.key.toUpperCase(), { status: ticket.status, ...(typeof ticket.statusCategory === "string" ? { statusCategory: ticket.statusCategory } : {}) });
    }
  }

  let jev = new Map<string, JevInfo>();
  try {
    jev = jevInfoByTask(listRuns(notesDir));
  } catch (error) {
    errors.push(`Jev QA runs: ${error instanceof Error ? error.message : String(error)}`);
  }

  const runCache = new Map<string, ReturnType<typeof listTaskAgentRuns>>();
  const usageCache = new Map<string, RunUsage | undefined>();
  return buildNotesBoard({
    feedbackPrs: readGithubPrsListCache()?.feedbackPrs,
    tasks,
    now: options.now ?? Date.now(),
    doneWindowDays: options.doneWindowDays === undefined ? DONE_WINDOW_DAYS : options.doneWindowDays,
    noteFor,
    runsFor: (taskId) => {
      try {
        if (!runCache.has(taskId)) runCache.set(taskId, listTaskAgentRuns(taskId, notesDir));
        return runCache.get(taskId)!;
      } catch {
        return [];
      }
    },
    orchestrations,
    jiraParentOf: (key) => jiraParents.get(key),
    jiraStatusOf: (key) => jiraStatuses.get(key),
    agentNoteUpdates: readAgentNoteUpdates(notesDir),
    clearedFailureFor: (taskId) => readFailureAcknowledgement(taskId, notesDir),
    usageFor: (runId) => {
      try {
        if (usageCache.has(runId)) return usageCache.get(runId);
        const run = readAgentRun(runId);
        const status = run?.status;
        const tail = run && status?.state === "failed" && !status.error ? readRunEvents(run.dir, Math.max(0, status.eventCount - 30), 30).events : [];
        const lastError = tail.filter((event) => event.type === "error" || event.type === "stderr" || (event.type === "result" && !event.ok)).at(-1);
        const reviewPath = run?.spec.activity?.action === "review" ? run.spec.activity.notePath ?? run.spec.prompt.match(/Save the review as the DevHub note (pr-reviews\/[A-Za-z0-9_/-]+)/)?.[1] : undefined;
        const reviewFile = reviewPath && !reviewPath.includes("..") ? storage.read(reviewPath) : null;
        const reviewText = reviewFile && Array.isArray(reviewFile.content) ? blocksToText(reviewFile.content) : undefined;
        const usage = status ? { stateChangedAt: status.finishedAt ?? status.updatedAt, costUsd: status.costUsd, inputTokens: status.inputTokens, outputTokens: status.outputTokens, error: status.error || (lastError?.type === "error" ? lastError.message : lastError && "text" in lastError ? lastError.text : undefined), exitCode: status.exitCode, resultText: status.resultText, reviewText } : undefined;
        usageCache.set(runId, usage);
        return usage;
      } catch {
        return undefined;
      }
    },
    jev,
    errors,
  });
}
