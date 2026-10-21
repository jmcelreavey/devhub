import fs from "node:fs";
import path from "node:path";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { readModelTiers, type ModelTierSettings } from "./model-tiers";
import { AgentDispatchError, dispatchAgentRun, validateAgentCwd } from "@/lib/agent-runs/dispatch";
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { cancelAgentRun, listCapacityRuns, readAgentRun } from "@/lib/agent-runs/store";
import { execExternal } from "@/lib/exec-external";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { removeWorktreeAt } from "@/lib/repos/worktree-cleanup";
import { parseWorktreeList } from "@/lib/repos/worktree-parsers";
import { cancelManagedRun } from "@/lib/paseo/lifecycle";
import { getNotesDir } from "@/lib/notes/dir";
import { jevFailingGoals, qaBugCount } from "@/lib/qa/jev-summary";
import { activeQaJobCount, cancelQaRun, attachVerification, prepareTaskQaRun, qaRunsWithRecovery, taskQaTargetUrl, type TaskQaInput, type TaskQaPreparation } from "@/lib/qa/service";
import { resolveLocalGithubRepos, type ResolvedLocalRepo } from "@/lib/repos/resolution";
import { buildTaskPlanPrompt } from "@/lib/tasks/implement-prompt";
import { readTaskNoteMarkdown, resolveTaskNotePath } from "@/lib/tasks/implement-ready-gather";
import { selectTaskImplementationRepo } from "@/lib/tasks/implement-repo";
import { ensureTasksMigrated, getTasks, updateTask } from "@/lib/tasks/storage";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { getStorage } from "@/lib/storage-server";
import { readTaskNoteWithMigration } from "@shared/task-note/sections.ts";
import { resolveReopenTask } from "@/lib/tasks/reopen-task";
import { stopTaskAgentRun } from "./stop-task-work";
import { getTaskAgentRuns, isActiveTaskAgentRunStatus } from "@/lib/tasks/task-agent-runs";
import type { Task } from "@/lib/tasks/types";
import { summariseOrchestration, type OrchestrationSummary } from "./orchestration";
import { deleteOrchestration, listOrchestrations, mutateOrchestration, newOrchestration, readOrchestration, withOrchestrationMutationLock, withOrchestrationWorkLock } from "./orchestration-store";
import type { OrchestrateAskBackInput, OrchestrateRerunInput, OrchestrateResetInput, OrchestratePlanDecisionInput, OrchestrateAnswerRepoInput, OrchestrateModeInput, OrchestrateRetryInput, OrchestrateStartInput, OrchestrateUiInput } from "./schema";
import { columnForPhase, safeNoteStatus, decideAutoPlan, advanceAuto, newAutoState, retryAuto, askBackAuto, rerunVerification, setUiOverride, type AutoDeps } from "./auto-mode";
import { detectUiChange, planPaths } from "./ui-detect";
import { LARGE_DIFF, parseNumstat, pickAutoTier, type DiffStats } from "./auto-tiers";
import { StoryboardError } from "./errors";
import { ensurePreview, stopPreview } from "./preview";
import type { AutoState, OrchestrationCheckoutChoice, OrchestrationQuestion, OrchestrationRecord } from "./types";
import { autoLaunchCheckout, autoLaunchPrompt, autoTierDispatch, type AutoLaunchOptions } from "./launch-options";

/**
 * Orchestrator: Start on auto writes the orchestration record and dispatches
 * the first plan run through the normal agent dispatch, linked to the task.
 * From there auto mode (auto-mode.ts) advances the task on its own: plan,
 * before video, implement, draft PR, review + Jev QA, fix loop, ready.
 *
 * The user's click is the opt-in; nothing here runs without it. When DevHub
 * can't tell which checkout to use, it asks one question instead of guessing.
 */

export interface OrchestratorDeps {
  dispatch: typeof dispatchAgentRun;
  resolveRepos: () => Promise<ResolvedLocalRepo[]>;
  findTask: (taskId: string, taskDate: string) => Promise<Task | null>;
  /** Resolve active-profile tasks even when they have never been on Auto. */
  resolveTask?: (taskId: string) => Promise<Task>;
  /** Is the checkout dirty, and how many other active runs already work in it? */
  inspectCheckout?: (cwd: string, ownRunIds: readonly string[]) => Promise<CheckoutSignals>;
  /** Cancel one run cleanly (managed runs through their runtime). */
  cancelRun?: (runId: string) => Promise<string>;
  /** Add a repo link to the task, replacing only the link `previousRepoName` named. */
  linkRepo?: (taskId: string, taskDate: string, repoName: string, previousRepoName?: string) => Promise<void>;
  /** Throws when a picked folder can't host a run (same rules as dispatch). */
  validateCwd?: (cwd: string) => unknown;
  /** The task note's own body (its plan, before an agent has written one), for the risk heuristic's size check. */
  readPlanNote?: (task: Task, taskDate: string) => string | null;
  /** Prepare the same Jev run used by /qa after implementation finishes. */
  prepareTaskQa?: (input: TaskQaInput, notesDir: string) => TaskQaPreparation;
  /** Active agents plus Jev runs; auto mode never starts a third heavy job. */
  activeHeavyJobs?: () => number;
  /** Jev uses one workspace lease, so a second QA run waits even below the global heavy-job cap. */
  activeQaJobs?: () => number;
  /** Auto mode's own seams (tests). Anything missing uses the real implementation. */
  auto?: Partial<AutoDeps>;
}

export interface CheckoutSignals {
  dirty: boolean;
  activeRuns: number;
}

async function defaultInspectCheckout(cwd: string, ownRunIds: readonly string[]): Promise<CheckoutSignals> {
  let dirty = false;
  try {
    // Tracked changes only: untracked scratch files don't make a plan run unsafe.
    const { stdout } = await execExternal("git", ["status", "--porcelain", "--untracked-files=no"], { cwd, timeoutMs: 5000, label: "git:status" });
    dirty = stdout.trim().length > 0;
  } catch (error) {
    // Not a git checkout (or git stalled): a worktree can't be made either, so the checkout it is.
    console.warn("[storyboard-orchestrate] git status failed; treating the checkout as clean", error instanceof Error ? error.message : error);
  }
  const wanted = path.resolve(cwd);
  // This task's own runs don't count: after Manual, the cancelled run can still be winding down.
  const activeRuns = listCapacityRuns().filter((run) => !ownRunIds.includes(run.spec.id) && run.spec.cwd && path.resolve(run.spec.cwd) === wanted).length;
  return { dirty, activeRuns };
}

/** Never lets a note-read failure block dispatch: worst case, size falls back to the title. */
function defaultReadPlanNote(task: Task, taskDate: string): string | null {
  try {
    return readTaskNoteMarkdown(resolveTaskNotePath(task, taskDate));
  } catch (error) {
    console.warn("[storyboard-orchestrate] couldn't read the task note; sizing on the title instead", error instanceof Error ? error.message : error);
    return null;
  }
}

async function defaultCancelRun(runId: string): Promise<string> {
  const run = readAgentRun(runId);
  if (!run || !isActiveAgentRunState(run.status.state)) return "already-finished";
  if (run.spec.runtime === "generation") return "not-cancellable";
  const result = run.spec.runtime === "aionui" || run.spec.runtime === "paseo" ? await cancelManagedRun(run) : cancelAgentRun(run);
  return result.outcome;
}

/** Keep every link except the one the repo question was about (or a duplicate of the new one). */
export function replaceRepoLink(links: Task["links"], repoName: string, previousRepoName?: string): NonNullable<Task["links"]> {
  const kept = (links ?? []).filter((link) => !(link.kind === "repo" && (link.id === previousRepoName || link.id === repoName)));
  return [...kept, { kind: "repo", id: repoName, label: repoName.split("/").at(-1) ?? repoName }];
}

async function defaultLinkRepo(taskId: string, taskDate: string, repoName: string, previousRepoName?: string): Promise<void> {
  await ensureTasksMigrated();
  const task = getTasks(taskDate).find((item) => item.id === taskId);
  if (!task) throw new StoryboardError("That task could not be found on that day.", 404);
  await updateTask(taskId, { links: replaceRepoLink(task.links, repoName, previousRepoName) }, taskDate);
}

// "auth\\w*" used to catch "author"/"authored"; the suffix list below only matches the security sense.
const RISKY_WORDS = /\b(refactor\w*|migrat\w*|rewrite|overhaul|schema|auth(?:entication|orisation|orization)?|security|drop|upgrade|rename|monorepo|breaking)\b/i;
// "delete" alone flagged "Delete the old button"; only count it near something destructive.
const DELETE_WITH_CONTEXT = /\bdelete\b(?:(?!\.).){0,40}?\b(?:data|database|db|table|branch|files?|records?)\b|\b(?:data|database|db|table|branch|files?|records?)\b(?:(?!\.).){0,40}?\bdelete\b/i;
/** Only a task with no note yet is sized on its own text: a long title is a long description. */
const LARGE_TEXT = 280;
/** Real scope: this many files named in the plan, or planned steps, isolates the work. */
export const LARGE_PLAN = { files: 8, steps: 12 };

/** Fenced code blocks and stack-trace-shaped lines say nothing about scope. */
function planBodySignal(noteBody: string | null | undefined): string {
  if (!noteBody) return "";
  return noteBody
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*at\s+\S+.*$/gm, "")
    .replace(/^.*Traceback \(most recent call last\):?.*$/gim, "");
}

const STEP_SECTION = /^#{1,6}\s+(?:plan|steps|waypoints)\b/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?\S/;

/** Files the plan names and the list items under its Plan / Steps / Waypoints headings. */
export function planScope(noteBody: string | null | undefined): { files: number; steps: number } {
  const body = planBodySignal(noteBody);
  let sectionDepth: number | null = null;
  let steps = 0;
  for (const line of body.split("\n")) {
    const heading = line.match(/^(#{1,6})\s/);
    if (heading) {
      if (sectionDepth === null || heading[1].length <= sectionDepth) sectionDepth = STEP_SECTION.test(line) ? heading[1].length : null;
    } else if (sectionDepth !== null && LIST_ITEM.test(line)) steps += 1;
  }
  return { files: planPaths(body).length, steps };
}

/**
 * A reason the task looks large or risky enough to isolate, or null. Heuristic
 * and explainable on purpose. "Large" comes from scope, never from how long
 * the note is: the diff once Build has one, else the files and steps the plan
 * names. Only a task with no note falls back to the length of its title.
 */
export function taskRiskReason(task: Pick<Task, "text">, noteBody?: string | null, diff?: DiffStats | null): string | null {
  const word = task.text.match(RISKY_WORDS)?.[0] ?? (DELETE_WITH_CONTEXT.test(task.text) ? "delete" : null);
  if (word) return `task looks risky ("${word.toLowerCase()}")`;
  if (diff && diff.files > 0) {
    return diff.files >= LARGE_DIFF.files || diff.lines >= LARGE_DIFF.lines ? `task looks large (${diff.files} files, ${diff.lines} lines changed)` : null;
  }
  if (noteBody?.trim()) {
    const scope = planScope(noteBody);
    if (scope.files >= LARGE_PLAN.files) return `task looks large (${scope.files} files in the plan)`;
    if (scope.steps >= LARGE_PLAN.steps) return `task looks large (${scope.steps} planned steps)`;
    return null;
  }
  return task.text.length > LARGE_TEXT ? "task looks large (long description)" : null;
}

/**
 * Checkout by default (same as the Plan dialog). A worktree when the checkout
 * is dirty, another run is already working in it, or the task looks large/risky.
 */
export function chooseCheckoutMode(signals: CheckoutSignals, risk: string | null): { mode: "checkout" | "worktree"; reason: string } {
  const reasons: string[] = [];
  if (signals.dirty) reasons.push("checkout has uncommitted changes");
  if (signals.activeRuns > 0) reasons.push(`${signals.activeRuns} other run${signals.activeRuns === 1 ? "" : "s"} active on this repo`);
  if (risk) reasons.push(risk);
  if (reasons.length) return { mode: "worktree", reason: reasons.join("; ") };
  return { mode: "checkout", reason: "clean checkout, no other active run, small task" };
}

const defaultDeps: OrchestratorDeps = {
  resolveTask: resolveReopenTask,
  dispatch: dispatchAgentRun,
  resolveRepos: resolveLocalGithubRepos,
  findTask: async (taskId, taskDate) => {
    await ensureTasksMigrated();
    return getTasks(taskDate).find((task) => task.id === taskId) ?? null;
  },
};

export const REPO_QUESTION_ID = "repo";

export interface StartResult {
  orchestration: OrchestrationRecord;
  /** False when the task was already on auto; nothing new was started. */
  created: boolean;
  replayed: boolean;
  /** Run started by this call, if any. */
  runId: string | null;
  dispatchError: string | null;
}

async function resolveCheckout(input: OrchestrateStartInput, task: Task, deps: OrchestratorDeps): Promise<{ repoName?: string; cwd?: string }> {
  const repoName = input.repoName ?? task.links?.find((link) => link.kind === "repo")?.id;
  if (input.cwd) return { repoName, cwd: input.cwd };
  if (task.teamPickup) return { repoName, cwd: task.teamPickup.cwd };
  if (!repoName) return {};
  const local = selectTaskImplementationRepo(repoName, await deps.resolveRepos());
  return { repoName, ...(local ? { cwd: local.repo.path } : {}) };
}

function repoQuestion(repoName: string | undefined, now: string): OrchestrationQuestion {
  return {
    id: REPO_QUESTION_ID,
    stepId: "plan",
    kind: "repo",
    prompt: repoName ? `Which checkout is ${repoName}? It isn't cloned where DevHub can find it.` : "Which repo should this task run in?",
    state: "open",
    askedAt: now,
  };
}

/** A start that never got a run (no repo, or dispatch failed) can be retried by starting again. */
function canRetryStart(record: OrchestrationRecord): boolean {
  return record.runIds.length === 0 && (record.status === "paused" || record.status === "needs-you");
}

/**
 * Starts in flight in this process, by dispatcher, task and request: a concurrent
 * replay joins the first instead of dispatching again. Another process's replay
 * still goes through the record's lock and the dispatch request ID.
 */
const startsInFlight = new WeakMap<OrchestratorDeps, Map<string, Promise<StartResult>>>();

export async function startOrchestration(
  input: OrchestrateStartInput,
  context: { origin: string },
  deps: OrchestratorDeps = defaultDeps,
  notesDir = getNotesDir(),
): Promise<StartResult> {
  // Both copies of a double-sent start would see "starting" with no run yet and both dispatch,
  // leaving a second plan agent running beside the one auto mode settles on.
  const key = `${notesDir}\0${input.taskId}\0${input.idempotencyKey}`;
  const starts = startsInFlight.get(deps) ?? new Map<string, Promise<StartResult>>();
  startsInFlight.set(deps, starts);
  const inFlight = starts.get(key);
  if (inFlight) return inFlight.then((result) => ({ ...result, replayed: true }));
  const start = withOrchestrationWorkLock(input.taskId, notesDir, () => startOrchestrationOnce(input, context, deps, notesDir)).finally(() => starts.delete(key));
  starts.set(key, start);
  return start;
}

async function startOrchestrationOnce(
  input: OrchestrateStartInput,
  context: { origin: string },
  deps: OrchestratorDeps,
  notesDir: string,
): Promise<StartResult> {
  const task = await deps.findTask(input.taskId, input.taskDate);
  if (!task) throw new StoryboardError("That task could not be found on that day.", 404);
  if (task.done || task.abandonedAt) throw new StoryboardError("That task is closed. Reopen it before starting it on auto.", 409);
  if (isTaskOwnershipBlocked(task)) throw new StoryboardError("This task's ownership is pending or handed off and is read-only.", 409);
  // Start on auto for a task parked on Manual is the same ask as flipping it back to Auto. Doing nothing left the button looking dead.
  const parked = readOrchestration(input.taskId, notesDir);
  if (parked?.auto && parked.status === "paused-manual") {
    const resumed = await setOrchestrationMode({ action: "mode", taskId: input.taskId, mode: "auto", idempotencyKey: input.idempotencyKey }, context, deps, notesDir);
    return { orchestration: resumed.orchestration, created: false, replayed: false, runId: resumed.runId, dispatchError: resumed.dispatchError };
  }
  const checkout = await resolveCheckout(input, task, deps);
  const now = new Date().toISOString();

  // Phase A: claim the start under the lock. A second click (or another tab) sees the claim and does nothing.
  let claimed = false;
  const first = await mutateOrchestration(input.taskId, input.idempotencyKey, (current) => {
    if (current && !canRetryStart(current)) return null;
    const record = current ?? newOrchestration({ taskId: task.id, taskDate: input.taskDate }, now);
    record.auto = record.auto ?? newAutoState(context.origin, input.pauseAfterPlan);
    if (input.pauseAfterPlan !== undefined) record.auto.pauseAfterPlan = input.pauseAfterPlan;
    if (input.stepOverrides !== undefined || input.instructions !== undefined || input.worktree !== undefined || input.skipPlan !== undefined) {
      record.launchOptions = { ...record.launchOptions,
        ...(input.stepOverrides !== undefined ? { stepOverrides: input.stepOverrides } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.worktree !== undefined ? { worktree: input.worktree } : {}),
        ...(input.skipPlan ? { skipPlan: true } : {}),
      };
    }
    if (input.tiers !== undefined) record.tiers = input.tiers;
    if (!checkout.cwd) {
      if (current) return null; // Still nothing to run in; the open question stands.
      record.status = "needs-you";
      record.questions = [repoQuestion(checkout.repoName, now)];
      if (checkout.repoName) record.repo = { name: checkout.repoName };
      return record;
    }
    claimed = true;
    record.status = "starting";
    // Skip planning: begin at Implement. The ticker (or the advance below) dispatches it; no plan run is started.
    record.executionStep = input.skipPlan ? "implement" : "plan";
    if (input.skipPlan && record.auto) { record.auto.phase = "implement"; record.auto.attempt = 0; }
    record.repo = { ...(checkout.repoName ? { name: checkout.repoName } : {}), cwd: checkout.cwd };
    record.tiers = record.tiers ?? readModelTiers(notesDir);
    delete record.lastError;
    record.questions = record.questions.map((question) => question.kind === "repo" && question.state === "open"
      ? { ...question, state: "answered", answeredAt: now, answer: checkout.repoName ?? checkout.cwd }
      : question);
    return record;
  }, notesDir);

  // A replay of the same request after a lost response re-sends the same dispatch;
  // the request ID makes dispatch return the run it already started.
  if (claimed && first.record.auto?.phase === "implement") {
    await advanceAuto(input.taskId, autoDeps(deps, notesDir), notesDir);
    return { orchestration: readOrchestration(input.taskId, notesDir) ?? first.record, created: first.created, replayed: first.replayed, runId: null, dispatchError: null };
  }
  const shouldDispatch = first.record.status === "starting" && first.record.runIds.length === 0 && (claimed || first.replayed);
  if (!shouldDispatch) {
    return { orchestration: first.record, created: first.created, replayed: first.replayed, runId: null, dispatchError: null };
  }

  const cwd = first.record.repo?.cwd ?? checkout.cwd!;
  const { runId, dispatchError, choice } = await dispatchPlanRun(task, input.taskDate, cwd, first.record.repo?.name, first.record.runIds, `storyboard-orchestrate-${first.record.auto?.cycleId ? `${first.record.auto.cycleId}-` : ""}${input.idempotencyKey}`, context, deps, first.record.tiers, first.record.auto?.pauseAfterPlan, first.record.launchOptions);

  // Phase B: record the outcome. A failed dispatch pauses; Start on auto again retries.
  const second = await recordDispatch(input.taskId, runId, choice, (current) => {
    // A concurrent replay of this start already settled it (often with a run); don't strand that run behind "paused".
    if (current.status !== "starting" || current.runIds.length > 0) return null;
    current.status = "paused";
    current.lastError = dispatchError ?? "The plan run did not start.";
    return current;
  }, deps, notesDir);
  // The "before" video is recorded once the plan is settled (auto mode's baseline phase), not at the click.
  return { orchestration: second, created: first.created, replayed: first.replayed, runId, dispatchError };
}

async function dispatchPlanRun(
  task: Task, taskDate: string, cwd: string, repoName: string | undefined, ownRunIds: readonly string[], requestId: string,
  context: { origin: string }, deps: OrchestratorDeps, tiers?: ModelTierSettings, pauseAfterPlan?: boolean,
  launchOptions?: AutoLaunchOptions,
): Promise<{ runId: string | null; dispatchError: string | null; choice: OrchestrationCheckoutChoice }> {
  const planChoice = autoTierDispatch(tiers, "plan", undefined, launchOptions);
  const signals = await (deps.inspectCheckout ?? defaultInspectCheckout)(cwd, ownRunIds);
  const noteBody = (deps.readPlanNote ?? defaultReadPlanNote)(task, taskDate);
  const choice = autoLaunchCheckout({ ...chooseCheckoutMode(signals, taskRiskReason(task, noteBody)), decidedAt: new Date().toISOString() }, launchOptions);
  const isolated = choice.mode === "worktree";
  let runId: string | null = null;
  let dispatchError: string | null = null;
  try {
    const run = await deps.dispatch({
      requestId,
      // Empty = the user's preferred Paseo provider, same as the Plan dialog's default.
      provider: planChoice?.provider ?? "",
      ...(planChoice?.model ? { model: planChoice.model } : {}),
      ...(planChoice.effort ? { effort: planChoice.effort } : {}),
      // A worktree run must not be pointed back at the checkout it was isolated from.
      prompt: autoLaunchPrompt(buildTaskPlanPrompt({ pauseAfterPlan, origin: context.origin, taskId: task.id, date: taskDate, ...(isolated ? { isolated } : { cwd }), repoName, jiraKey: task.jiraKey }), launchOptions),
      cwd,
      title: `Plan ${task.text}`,
      worktree: isolated,
      prepareCheckout: launchOptions?.worktree === false,
      depth: 0,
      activity: { source: "interactive", action: "plan", taskId: task.id, taskDate, ...(repoName ? { repoName } : {}) },
    }, { defer: true });
    runId = run.spec.id;
  } catch (error) {
    if (!(error instanceof AgentDispatchError)) console.error("[storyboard-orchestrate] plan dispatch failed", error);
    dispatchError = error instanceof Error ? error.message : String(error);
  }
  return { runId, dispatchError, choice };
}

/**
 * Phase B for a start or a resume: record the run under the lock. If the user
 * switched to Manual while the dispatch was in flight, Manual wins: the run is
 * recorded (so it stays visible) and stopped, instead of working unseen.
 * `onFailure` decides what a dispatch with no run does to the record.
 */
async function recordDispatch(
  taskId: string, runId: string | null, choice: OrchestrationCheckoutChoice | undefined,
  onFailure: (current: OrchestrationRecord) => OrchestrationRecord | null,
  deps: OrchestratorDeps, notesDir: string,
): Promise<OrchestrationRecord> {
  let stopRun = false;
  const result = await mutateOrchestration(taskId, null, (current) => {
    if (!current) return null;
    if (choice) current.checkout = choice;
    if (!runId) return onFailure(current);
    if (!current.runIds.includes(runId)) current.runIds.push(runId);
    if (current.auto && !current.auto.runs.some((entry) => entry.runId === runId)) {
      current.auto.runs.push({ runId, phase: current.auto.phase, round: current.auto.round, attempt: current.auto.attempt, at: new Date().toISOString() });
    }
    if (current.status === "paused-manual") {
      stopRun = true;
      return current;
    }
    current.status = "running";
    delete current.lastError;
    return current;
  }, notesDir);
  if (!stopRun || !runId) return result.record;
  const stopped = await cancelQuietly(runId, deps);
  if (!("error" in stopped)) return result.record;
  return noteCancelFailure(taskId, stopped.error, notesDir);
}

async function cancelQuietly(runId: string, deps: OrchestratorDeps): Promise<{ outcome: string } | { error: string }> {
  try {
    return { outcome: await (deps.cancelRun ?? defaultCancelRun)(runId) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function noteCancelFailure(taskId: string, error: string, notesDir: string): Promise<OrchestrationRecord> {
  const result = await mutateOrchestration(taskId, null, (current) => {
    if (!current || current.status !== "paused-manual") return null;
    current.lastError = `Switched to Manual, but the run did not stop: ${error}`;
    return current;
  }, notesDir);
  return result.record;
}

/** The folder's canonical `org/repo` name, or null when it isn't a repo DevHub recognises. */
async function resolveRepoNameForCwd(cwd: string, deps: OrchestratorDeps): Promise<string | null> {
  const wanted = path.resolve(cwd);
  const resolved = await deps.resolveRepos();
  return resolved.find((entry) => path.resolve(entry.repo.path) === wanted)?.fullName ?? null;
}

/**
 * Missing-repo answer: link the picked repo to the task, then resume auto
 * (start again) in the same call. The client sends only the folder — the
 * server resolves and verifies its canonical name instead of trusting
 * whatever name the picker displayed (a bare folder name, not `org/repo`).
 */
export async function answerRepoQuestion(
  input: OrchestrateAnswerRepoInput,
  context: { origin: string },
  deps: OrchestratorDeps = defaultDeps,
  notesDir = getNotesDir(),
): Promise<StartResult> {
  return withOrchestrationWorkLock(input.taskId, notesDir, () => answerRepoQuestionOnce(input, context, deps, notesDir));
}

async function answerRepoQuestionOnce(input: OrchestrateAnswerRepoInput, context: { origin: string }, deps: OrchestratorDeps, notesDir: string): Promise<StartResult> {
  const record = readOrchestration(input.taskId, notesDir);
  if (!record) throw new StoryboardError("That task is not on auto.", 404);
  const retried = record.idempotency.some((entry) => entry.key === input.idempotencyKey);
  let repoName = record.repo?.name;
  // Check before touching the task: a stale picker must not rewrite the repo link of a task that has moved on.
  if (!retried) {
    const waiting = canRetryStart(record) && record.questions.some((question) => question.kind === "repo" && question.state === "open");
    if (!waiting) throw new StoryboardError("That task is no longer waiting for a repo.", 409);
    try {
      (deps.validateCwd ?? validateAgentCwd)(input.cwd);
    } catch (error) {
      throw new StoryboardError(error instanceof Error ? error.message : "That folder can't be used.", 400);
    }
    const resolved = await resolveRepoNameForCwd(input.cwd, deps);
    if (!resolved) throw new StoryboardError("That folder isn't a repo DevHub recognises. Pick one from the list.", 400);
    repoName = resolved;
    // Replace only the link this question was about; a multi-repo task keeps its other links.
    await (deps.linkRepo ?? defaultLinkRepo)(input.taskId, record.taskDate, repoName, record.repo?.name);
  }
  return startOrchestration({ action: "start", taskId: input.taskId, taskDate: record.taskDate, idempotencyKey: input.idempotencyKey, cwd: input.cwd, repoName }, context, deps, notesDir);
}

export interface ModeResult {
  orchestration: OrchestrationRecord;
  runId: string | null;
  cancelled: string | null;
  dispatchError: string | null;
}

/**
 * Auto/Manual switch. User-initiated, one click. Manual parks the record at
 * `paused-manual` and cancels the active run; Auto dispatches a fresh run for
 * the current step (Phase 1: plan) and goes back to running. A resume that
 * can't dispatch stays Manual with the error, so the switch is the retry.
 */
export async function setOrchestrationMode(
  input: OrchestrateModeInput,
  context: { origin: string },
  deps: OrchestratorDeps = defaultDeps,
  notesDir = getNotesDir(),
): Promise<ModeResult> {
  return input.mode === "auto"
    ? withOrchestrationWorkLock(input.taskId, notesDir, () => setOrchestrationModeOnce(input, context, deps, notesDir))
    : setOrchestrationModeOnce(input, context, deps, notesDir);
}

async function setOrchestrationModeOnce(input: OrchestrateModeInput, context: { origin: string }, deps: OrchestratorDeps, notesDir: string): Promise<ModeResult> {
  const existing = readOrchestration(input.taskId, notesDir);
  if (!existing) throw new StoryboardError("That task is not on auto.", 404);
  if (existing.status === "pr-created" || existing.status === "stopped") throw new StoryboardError("That task has finished on auto; there is nothing to switch.", 409);

  if (input.mode === "manual") {
    // Flip first, under the lock, then cancel the newest run the record knows about.
    // A dispatch that lands after the flip sees Manual and stops its own run (recordDispatch).
    let switched = false;
    const result = await mutateOrchestration(input.taskId, input.idempotencyKey, (current) => {
      if (!current || current.status === "paused-manual" || current.status === "pr-created" || current.status === "stopped") return null;
      switched = true;
      current.status = "paused-manual";
      delete current.lastError;
      return current;
    }, notesDir);
    const latest = result.record.runIds.at(-1);
    // A replay cancels again: cancelling is idempotent, and the first attempt may have died before it got there.
    if ((!switched && !result.replayed) || !latest) return { orchestration: result.record, runId: null, cancelled: null, dispatchError: null };
    const stopped = await cancelQuietly(latest, deps);
    if (!("error" in stopped)) return { orchestration: result.record, runId: null, cancelled: stopped.outcome, dispatchError: null };
    return { orchestration: await noteCancelFailure(input.taskId, stopped.error, notesDir), runId: null, cancelled: `failed: ${stopped.error}`, dispatchError: null };
  }

  // Auto mode records resume their current phase on a fresh attempt; the state machine dispatches it.
  // Same contract as before: a resume that can't run stays Manual with the reason, so Auto again is the retry.
  if (existing.auto) {
    const stayManual = async (reason: string, key: string | null) => (await mutateOrchestration(input.taskId, key, (current) => {
      if (!current || current.status !== "paused-manual") return null;
      current.lastError = `Couldn't resume auto: ${reason}`;
      return current;
    }, notesDir)).record;
    const task = existing.status === "paused-manual" ? await deps.findTask(input.taskId, existing.taskDate) : null;
    const blocked = existing.status !== "paused-manual" ? null : !task ? "That task could not be found." : task.done || task.abandonedAt ? "That task is closed. Reopen it before resuming auto." : isTaskOwnershipBlocked(task) ? "This task is read-only while ownership is pending or handed off." : null;
    if (blocked) return { orchestration: await stayManual(blocked, input.idempotencyKey), runId: null, cancelled: null, dispatchError: blocked };
    const resumed = await mutateOrchestration(input.taskId, input.idempotencyKey, (current) => {
      if (!current?.auto || current.status !== "paused-manual") return null;
      if (!current.repo?.cwd) {
        current.status = current.questions.some((question) => question.state === "open") ? "needs-you" : "paused";
        return current;
      }
      if (current.auto.phase === "ready") { current.status = "ready-for-review"; return current; }
      if (current.auto.waiting?.kind === "plan-approval") { current.status = "needs-you"; return current; }
      current.status = "starting";
      current.auto.attempt += 1;
      if (input.guidance) current.auto.recoveryGuidance = { text: input.guidance, phase: current.auto.phase, attempt: current.auto.attempt };
      if (current.auto.phase === "verify") current.auto.verify = {};
      delete current.auto.waiting;
      delete current.lastError;
      return current;
    }, notesDir);
    if (resumed.record.status !== "starting") return { orchestration: resumed.record, runId: null, cancelled: null, dispatchError: null };
    const executes = await advanceAuto(input.taskId, autoDeps(deps, notesDir), notesDir);
    for (const execute of executes) void execute();
    let after = readOrchestration(input.taskId, notesDir) ?? resumed.record;
    const failure = after.auto?.waiting?.kind === "failure" ? after.auto.waiting.reason.replace(/^Couldn't start [^:]+: /, "") : null;
    if (failure) {
      after = (await mutateOrchestration(input.taskId, null, (current) => {
        if (!current?.auto) return null;
        delete current.auto.waiting;
        current.status = "paused-manual";
        current.lastError = `Couldn't resume auto: ${failure}`;
        return current;
      }, notesDir)).record;
    }
    const newest = after.runIds.at(-1);
    return { orchestration: after, runId: newest && newest !== resumed.record.runIds.at(-1) ? newest : null, cancelled: null, dispatchError: failure };
  }

  // Auto: claim the resume under the lock so a double click dispatches once.
  let claimed = false;
  const first = await mutateOrchestration(input.taskId, input.idempotencyKey, (current) => {
    if (!current || current.status !== "paused-manual") return null;
    if (!current.repo?.cwd) {
      current.status = current.questions.some((question) => question.state === "open") ? "needs-you" : "paused";
      return current;
    }
    claimed = true;
    current.status = "starting";
    delete current.lastError;
    return current;
  }, notesDir);
  const shouldDispatch = first.record.status === "starting" && (claimed || first.replayed);
  if (!shouldDispatch) return { orchestration: first.record, runId: null, cancelled: null, dispatchError: null };

  const task = await deps.findTask(input.taskId, first.record.taskDate);
  let runId: string | null = null;
  let dispatchError: string | null = !task ? "That task could not be found." : task.done || task.abandonedAt ? "That task is closed. Reopen it before resuming auto." : null;
  let choice: OrchestrationCheckoutChoice | undefined;
  if (task && !dispatchError) {
    ({ runId, dispatchError, choice } = await dispatchPlanRun(task, first.record.taskDate, first.record.repo!.cwd!, first.record.repo?.name, first.record.runIds, `storyboard-resume-${input.idempotencyKey}`, context, deps, first.record.tiers, first.record.auto?.pauseAfterPlan, first.record.launchOptions));
  }
  const second = await recordDispatch(input.taskId, runId, choice, (current) => {
    if (current.status !== "starting") return null;
    // Back to Manual with the reason: switching to Auto again is the retry.
    current.status = "paused-manual";
    current.lastError = `Couldn't resume auto: ${dispatchError ?? "the plan run did not start."}`;
    return current;
  }, deps, notesDir);
  return { orchestration: second, runId, cancelled: null, dispatchError };
}

export function getOrchestration(taskId: string, notesDir = getNotesDir()): OrchestrationRecord {
  const record = readOrchestration(taskId, notesDir);
  if (!record) throw new StoryboardError("That task is not on auto.", 404);
  return record;
}

function latestRunStatus(record: OrchestrationRecord, notesDir: string) {
  const latest = record.runIds.at(-1);
  if (!latest) return undefined;
  return getTaskAgentRuns(record.taskId, notesDir).runs.find((run) => run.runId === latest)?.status;
}

export function orchestrationSummary(record: OrchestrationRecord, notesDir = getNotesDir()): OrchestrationSummary {
  return summariseOrchestration(record, latestRunStatus(record, notesDir));
}

export interface OrchestrationReconcileResult {
  orchestration: OrchestrationRecord;
  execute?: () => Promise<void>;
}

const QA_PREPARING = "Preparing automatic QA.";
const QA_QUEUED_CAPACITY = "QA queued: two heavy jobs are already running.";
const QA_QUEUED_WORKSPACE = "QA queued: another Jev QA run owns the workspace.";

function latestTaskRun(record: OrchestrationRecord, notesDir: string) {
  const latest = record.runIds.at(-1);
  if (!latest) return undefined;
  return getTaskAgentRuns(record.taskId, notesDir).runs.find((run) => run.runId === latest);
}

async function setQaOutcome(taskId: string, status: OrchestrationRecord["status"], reason: string | null, notesDir: string): Promise<OrchestrationRecord> {
  const result = await mutateOrchestration(taskId, null, (current) => {
    if (!current || current.executionStep !== "verify" || current.status === "paused-manual" || current.terminal) return null;
    current.status = status;
    if (reason) current.lastError = reason;
    else delete current.lastError;
    return current;
  }, notesDir);
  return result.record;
}

/** Poll-time transition from a completed implementation into the existing /qa service. */
export async function reconcileOrchestration(
  taskId: string,
  deps: OrchestratorDeps = defaultDeps,
  notesDir = getNotesDir(),
): Promise<OrchestrationReconcileResult> {
  return withOrchestrationWorkLock(taskId, notesDir, () => reconcileOrchestrationOnce(taskId, deps, notesDir));
}

async function reconcileOrchestrationOnce(taskId: string, deps: OrchestratorDeps, notesDir: string): Promise<OrchestrationReconcileResult> {
  const initial = readOrchestration(taskId, notesDir);
  if (initial && isTaskOwnershipBlocked(await deps.findTask(taskId, initial.taskDate))) return { orchestration: initial };
  if (!initial || initial.terminal || initial.status === "paused-manual" || initial.status === "stopped") {
    if (!initial) throw new StoryboardError("That task is not on auto.", 404);
    return { orchestration: initial };
  }
  if (initial.auto) {
    const executes = await advanceAuto(taskId, autoDeps(deps, notesDir), notesDir);
    const orchestration = readOrchestration(taskId, notesDir) ?? initial;
    if (!executes.length) return { orchestration };
    return { orchestration, execute: async () => { for (const execute of executes) await execute(); } };
  }
  const sourceRun = latestTaskRun(initial, notesDir);
  const implementationFinished = initial.executionStep === "implement" && initial.status === "running"
    && sourceRun?.status === "done" && (!sourceRun.role || sourceRun.role === "implement");
  const queued = initial.executionStep === "verify" && initial.status === "starting"
    && [QA_QUEUED_CAPACITY, QA_QUEUED_WORKSPACE].includes(initial.lastError ?? "");
  if (!implementationFinished && !queued) return { orchestration: initial };
  if (!sourceRun) return { orchestration: initial };

  let claimed = false;
  const claim = await mutateOrchestration(taskId, null, (current) => {
    if (!current || current.terminal || current.status === "paused-manual" || current.status === "stopped") return null;
    const canClaimFinished = current.executionStep === "implement" && current.status === "running" && current.runIds.at(-1) === sourceRun.runId;
    const canClaimQueued = current.executionStep === "verify" && current.status === "starting"
      && [QA_QUEUED_CAPACITY, QA_QUEUED_WORKSPACE].includes(current.lastError ?? "");
    if (!canClaimFinished && !canClaimQueued) return null;
    claimed = true;
    current.executionStep = "verify";
    current.status = "starting";
    current.lastError = QA_PREPARING;
    return current;
  }, notesDir);
  if (!claimed) return { orchestration: claim.record };

  const task = await deps.findTask(taskId, claim.record.taskDate);
  if (!task || task.done) {
    const reason = task ? "QA skipped: the task was closed before verification could start." : "QA skipped: the task could not be found.";
    return { orchestration: await setQaOutcome(taskId, "paused", reason, notesDir) };
  }
  const qaJobs = (deps.activeQaJobs ?? activeQaJobCount)();
  const heavyJobs = (deps.activeHeavyJobs ?? (() => listCapacityRuns().length + activeQaJobCount()))();
  if (heavyJobs >= 2) return { orchestration: await setQaOutcome(taskId, "starting", QA_QUEUED_CAPACITY, notesDir) };
  if (qaJobs >= 1) return { orchestration: await setQaOutcome(taskId, "starting", QA_QUEUED_WORKSPACE, notesDir) };

  let prepared: TaskQaPreparation;
  try {
    prepared = (deps.prepareTaskQa ?? prepareTaskQaRun)({
      task,
      noteMarkdown: (deps.readPlanNote ?? defaultReadPlanNote)(task, claim.record.taskDate),
      sourceRunId: sourceRun.runId,
    }, notesDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/QA run is already active|QA runner already owns this workspace/i.test(message)) {
      return { orchestration: await setQaOutcome(taskId, "starting", QA_QUEUED_WORKSPACE, notesDir) };
    }
    const reason = `QA could not start: ${message}`;
    return { orchestration: await setQaOutcome(taskId, "paused", reason, notesDir) };
  }
  if (prepared.skipped) return { orchestration: await setQaOutcome(taskId, "paused", prepared.reason, notesDir) };
  if (!prepared.execute && prepared.run.receipt) {
    await attachVerification(taskId, prepared.run.receipt, notesDir);
    return { orchestration: readOrchestration(taskId, notesDir) ?? claim.record };
  }
  return { orchestration: await setQaOutcome(taskId, "running", null, notesDir), execute: prepared.execute };
}

export async function reconcileOrchestrations(
  deps: OrchestratorDeps = defaultDeps,
  notesDir = getNotesDir(),
): Promise<Array<() => Promise<void>>> {
  const { records } = listOrchestrations(notesDir);
  const results = await Promise.all(records.map(async (record) => {
    try {
      return await reconcileOrchestration(record.taskId, deps, notesDir);
    } catch (error) {
      // A reset may remove one record while another task has already reserved QA.
      console.error(`[storyboard-auto] could not reconcile ${record.taskId}`, error);
      return null;
    }
  }));
  return results.flatMap((result) => result?.execute ? [result.execute] : []);
}

export function listOrchestrationSummaries(notesDir = getNotesDir()): { orchestrations: OrchestrationSummary[]; errors: string[] } {
  const { records, errors } = listOrchestrations(notesDir);
  return { orchestrations: records.map((record) => orchestrationSummary(record, notesDir)), errors };
}

/** Changed files and lines since the implementation's base (commits plus working tree); null when git can't say. */
async function diffStats(work: NonNullable<AutoState["work"]>): Promise<DiffStats | null> {
  try {
    const { stdout } = await execExternal("git", ["diff", "--numstat", work.baseSha ?? "HEAD"], { cwd: work.worktree?.path ?? work.cwd, timeoutMs: 5000, label: "git:diff-numstat" });
    return parseNumstat(stdout);
  } catch {
    return null;
  }
}

/** Files the implementation changed since its base, including new untracked ones; null when git can't say. */
async function changedFiles(work: NonNullable<AutoState["work"]>): Promise<string[] | null> {
  const cwd = work.worktree?.path ?? work.cwd;
  try {
    const [diff, untracked] = await Promise.all([
      execExternal("git", ["diff", "--name-only", work.baseSha ?? "HEAD"], { cwd, timeoutMs: 5000, label: "git:diff-names" }),
      execExternal("git", ["ls-files", "--others", "--exclude-standard"], { cwd, timeoutMs: 5000, label: "git:untracked" }),
    ]);
    return [...new Set(`${diff.stdout}\n${untracked.stdout}`.split("\n").map((line) => line.trim()).filter(Boolean))];
  } catch {
    return null;
  }
}

function readNoteView(task: Task, taskDate: string): ReturnType<AutoDeps["noteView"]> {
  const notePath = resolveTaskNotePath(task, taskDate);
  try {
    const file = getStorage().read(notePath);
    const view = file && Array.isArray(file.content) ? readTaskNoteWithMigration(file.content) : null;
    return { view, markdown: readTaskNoteMarkdown(notePath), notePath };
  } catch (error) {
    console.warn("[storyboard-auto] couldn't read the task note", error instanceof Error ? error.message : error);
    return { view: null, markdown: null, notePath };
  }
}

/** The real implementations behind auto mode, with any test overrides from `deps`. */
export function autoDeps(deps: OrchestratorDeps, notesDir: string): AutoDeps {
  const heavy = deps.activeHeavyJobs ?? (() => listCapacityRuns().length + activeQaJobCount());
  return {
    dispatch: deps.dispatch,
    findTask: deps.findTask,
    noteView: readNoteView,
    runStatus: (taskId, runId) => getTaskAgentRuns(taskId, notesDir).runs.find((run) => run.runId === runId)?.status,
    taskRuns: (taskId) => getTaskAgentRuns(taskId, notesDir).runs.map((run) => ({ runId: run.runId, role: run.role, status: run.status, startedAt: run.startedAt })),
    runWork: (runId) => {
      const spec = readAgentRun(runId)?.spec;
      if (!spec?.cwd) return null;
      return { cwd: spec.cwd, ...(spec.worktree ? { worktree: spec.worktree } : {}), ...(spec.baseSha ? { baseSha: spec.baseSha } : {}) };
    },
    prepareTaskQa: deps.prepareTaskQa ?? prepareTaskQaRun,
    qaResult: async (qaRunId) => {
      const run = (await qaRunsWithRecovery(notesDir)).find((item) => item.id === qaRunId);
      if (!run) return null;
      return { finished: run.state === "finished", bugs: qaBugCount(run), failing: jevFailingGoals(run) };
    },
    activeHeavyJobs: heavy,
    activeQaJobs: deps.activeQaJobs ?? activeQaJobCount,
    setNoteStatus: (task, taskDate, status) => { updateTaskNoteSections({ taskId: task.id, date: taskDate }, { op: "set_status", status }); },
    chooseCheckout: async (task, taskDate, cwd, ownRunIds) => {
      const signals = await (deps.inspectCheckout ?? defaultInspectCheckout)(cwd, ownRunIds);
      const noteBody = (deps.readPlanNote ?? defaultReadPlanNote)(task, taskDate);
      return { ...chooseCheckoutMode(signals, taskRiskReason(task, noteBody)), decidedAt: new Date().toISOString() };
    },
    cancelRun: (runId) => cancelQuietly(runId, deps),
    detectUi: async ({ markdown, work }) => detectUiChange({ changedFiles: work ? await changedFiles(work) : null, planPaths: planPaths(markdown) }),
    pickTier: async ({ record, phase, work }) => {
      const settings = record.tiers ?? readModelTiers(notesDir);
      const diff = work && (phase === "verify" || phase === "fix") ? await diffStats(work) : null;
      const picked = pickAutoTier({ settings, phase, attempt: record.auto?.attempt ?? 0, round: record.auto?.round ?? 0, diff, findings: record.auto?.findings?.length });
      // No reason means the step's saved tier: leave it to the normal per-step choice.
      return picked.reason ? picked : {};
    },
    resolvePreview: async ({ record, task, markdown, cwd }) => {
      const url = taskQaTargetUrl(task, markdown);
      if (url) return { url, state: "url", reason: "Preview URL from the task." };
      return ensurePreview({ taskId: record.taskId, repoName: record.repo?.name, cwd });
    },
    stopPreview: (taskId) => stopPreview(taskId),
    cleanupWork: async (taskId) => {
      const { cleanupFinishedAutoWork } = await import("./cleanup-work");
      try { await cleanupFinishedAutoWork(taskId, notesDir); }
      catch (error) { console.warn("[storyboard-cleanup] kept checkout; scheduled cleanup will retry", error); }
    },
    workChanged: async (work) => { const stats = await diffStats(work); return stats ? stats.files > 0 : null; },
    restoreWork: async (work) => {
      const treePath = work.worktree?.path ?? work.cwd;
      if (fs.existsSync(treePath)) return "present";
      const { worktree } = work;
      if (!worktree?.branch) return "gone";
      // The folder was cleaned up but the branch (and its commits) survive: check it out again at the same path.
      const branch = await runGitRepoAsync(worktree.repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${worktree.branch}`]);
      if (branch.status === 1) return "gone";
      if (branch.status !== 0) throw new StoryboardError(branch.stderr.trim() || "Could not check the saved branch.", 409);
      const pruned = await runGitRepoAsync(worktree.repoRoot, ["worktree", "prune"]);
      if (pruned.status !== 0) throw new StoryboardError(pruned.stderr.trim() || "Could not prune the missing checkout.", 409);
      const added = await runGitRepoAsync(worktree.repoRoot, ["worktree", "add", "--", worktree.path, worktree.branch]);
      if (added.status !== 0) throw new StoryboardError(added.stderr.trim() || "Could not restore the saved checkout.", 409);
      return "restored";
    },
    ...deps.auto,
  };
}

/** The card's "UI change" toggle. `ui: null` goes back to what DevHub detects. */
export async function setOrchestrationUi(input: OrchestrateUiInput, notesDir = getNotesDir()): Promise<OrchestrationRecord> {
  const record = readOrchestration(input.taskId, notesDir);
  if (!record) throw new StoryboardError("That task is not on auto.", 404);
  if (!record.auto) throw new StoryboardError("This task was started before auto mode. Retry it on auto first.", 409);
  return setUiOverride(input.taskId, input.ui, notesDir);
}

/** Needs you → Retry (also the upgrade path for a task started before auto mode). */
export async function retryOrchestration(
  input: OrchestrateRetryInput,
  context: { origin: string },
  deps: OrchestratorDeps = defaultDeps,
  notesDir = getNotesDir(),
): Promise<OrchestrationReconcileResult> {
  if (!readOrchestration(input.taskId, notesDir)) throw new StoryboardError("That task is not on auto.", 404);
  await retryAuto(input.taskId, input.idempotencyKey, context.origin, notesDir, (record) => latestRunStatus(record, notesDir) === "done", input.guidance);
  return reconcileOrchestration(input.taskId, deps, notesDir);
}

export async function decideOrchestrationPlan(input: OrchestratePlanDecisionInput, deps: OrchestratorDeps = defaultDeps, notesDir = getNotesDir()): Promise<OrchestrationReconcileResult> {
  const record = getOrchestration(input.taskId, notesDir);
  const task = await deps.findTask(input.taskId, record.taskDate);
  if (!task) throw new StoryboardError("That task is not in the active profile.", 404);
  if (task.done || task.abandonedAt) throw new StoryboardError("That task is closed. Reopen it before continuing.", 409);
  const auto = autoDeps(deps, notesDir);
  if (input.decision === "approve") {
    const view = auto.noteView(task, record.taskDate).view;
    if (!view) throw new StoryboardError("The plan note is unavailable. Restore it or request a revision before approving.", 409);
    if (view.questions.some((question) => !question.resolved)) throw new StoryboardError("Answer the open questions before continuing.", 409);
  }
  const decided = await decideAutoPlan(input, auto, notesDir);
  if (decided.status === "starting" && decided.auto) safeNoteStatus(auto, task, record.taskDate, columnForPhase(decided.auto.phase));
  return reconcileOrchestration(input.taskId, deps, notesDir);
}

export interface ResetResult {
  stoppedRuns: number;
  removedCheckouts: string[];
  keptCheckouts: string[];
  /** Things Reset cannot undo from here, such as a pushed branch or an open PR. */
  leftBehind: string[];
}

/**
 * Put a task back to To do: stop its runs, forget auto mode and set its note to To do.
 * The task, its note and its run history stay. With `discardWork` the agent checkouts and their
 * local `devhub/agent/*` branches go too; anything pushed or opened elsewhere is reported, not touched.
 */
export async function resetTaskToTodo(input: OrchestrateResetInput, deps: OrchestratorDeps = defaultDeps, notesDir = getNotesDir()): Promise<ResetResult> {
  return withOrchestrationWorkLock(input.taskId, notesDir, () => withOrchestrationMutationLock(input.taskId, notesDir, () => resetTaskToTodoOnce(input, deps, notesDir)));
}

async function resetTaskToTodoOnce(input: OrchestrateResetInput, deps: OrchestratorDeps, notesDir: string): Promise<ResetResult> {
  const record = readOrchestration(input.taskId, notesDir);
  const task = deps.resolveTask
    ? await deps.resolveTask(input.taskId)
    : await deps.findTask(input.taskId, record?.taskDate ?? new Date().toLocaleDateString("en-CA"));
  if (!task) throw new StoryboardError("That task is not in the active profile.", 404);
  if (isTaskOwnershipBlocked(task)) throw new StoryboardError("This task's ownership is pending or handed off and is read-only.", 409);
  if (task.done || task.abandonedAt) throw new StoryboardError("Reopen the task before resetting it.", 409);
  if (record) await mutateOrchestration(input.taskId, null, (current) => current ? { ...current, status: "paused-manual" } : null, notesDir);
  const taskRuns = getTaskAgentRuns(input.taskId, notesDir).runs;
  const runIds = [...new Set([...(record?.runIds ?? []), ...taskRuns.map((run) => run.runId)])];
  const result: ResetResult = { stoppedRuns: 0, removedCheckouts: [], keptCheckouts: [], leftBehind: [] };
  for (const runId of runIds) {
    if (deps.cancelRun) {
      const outcome = await cancelQuietly(runId, deps);
      if ("error" in outcome) throw new StoryboardError(`Could not reset: ${outcome.error}`, 409);
      if (outcome.outcome === "not-cancellable") throw new StoryboardError("A run is still active. Stop it before resetting.", 409);
      if (outcome.outcome !== "already-finished") result.stoppedRuns++;
    } else {
      const saved = readAgentRun(runId);
      const active = saved ? isActiveAgentRunState(saved.status.state) : taskRuns.some((run) => run.runId === runId && isActiveTaskAgentRunStatus(run.status));
      if (active) { await stopTaskAgentRun(runId); result.stoppedRuns++; }
    }
  }
  for (const qa of await qaRunsWithRecovery(notesDir)) {
    if (qa.taskId === input.taskId && qa.state === "running" && !cancelQaRun(qa.id)) {
      throw new StoryboardError("QA is still running in another DevHub process. Stop it before resetting.", 409);
    }
  }
  autoDeps(deps, notesDir).stopPreview(input.taskId);
  // Collect checkouts before the record goes: auto's pinned worktree plus every run's own.
  const trees = new Map<string, { repoRoot: string; branch?: string }>();
  const pinned = record?.auto?.work?.worktree;
  if (pinned) trees.set(pinned.path, { repoRoot: pinned.repoRoot, ...(pinned.branch ? { branch: pinned.branch } : {}) });
  for (const runId of runIds) {
    const worktree = readAgentRun(runId)?.spec.worktree;
    if (worktree) trees.set(worktree.path, { repoRoot: worktree.repoRoot, ...(worktree.branch ? { branch: worktree.branch } : {}) });
  }
  // A failed note write leaves the parked record available for another reset.
  autoDeps(deps, notesDir).setNoteStatus(task, record?.taskDate ?? task.startDate, "todo");
  if (!input.discardWork) {
    result.keptCheckouts.push(...trees.keys());
    await deleteOrchestration(input.taskId, notesDir);
    return result;
  }
  for (const [treePath, { repoRoot, branch }] of trees) {
    const busy = listCapacityRuns().some((run) => {
      const cwd = run.spec.worktree?.path ?? run.spec.cwd;
      return cwd && (path.resolve(cwd) === path.resolve(treePath) || path.resolve(cwd).startsWith(path.resolve(treePath) + path.sep));
    });
    if (busy) { result.keptCheckouts.push(treePath); continue; }
    const listed = await runGitRepoAsync(repoRoot, ["worktree", "list", "--porcelain"]);
    const currentTree = listed.status === 0 ? parseWorktreeList(listed.stdout).find((tree) => path.resolve(tree.path) === path.resolve(treePath)) : null;
    // A saved path can be reused for someone else's branch after cleanup.
    if (!currentTree || currentTree.locked || currentTree.branch !== branch) { result.keptCheckouts.push(treePath); continue; }
    const removed = await removeWorktreeAt(repoRoot, treePath, true);
    if (!removed.ok) { result.keptCheckouts.push(treePath); continue; }
    result.removedCheckouts.push(treePath);
    // Only DevHub's own agent branches; a branch named by hand is the user's to delete.
    if (branch?.startsWith("devhub/agent/")) {
      const deleted = await runGitRepoAsync(repoRoot, ["branch", "-D", "--", branch]);
      if (deleted.status !== 0) result.keptCheckouts.push(`branch ${branch}`);
      else if ((await runGitRepoAsync(repoRoot, ["ls-remote", "--heads", "origin", branch])).stdout.trim()) result.leftBehind.push(`${branch} is still pushed to origin; delete it there and close any PR.`);
    }
  }
  await deleteOrchestration(input.taskId, notesDir);
  return result;
}

/** Re-run the review or Jev QA, then let auto mode pick the new attempt up straight away. */
export async function rerunOrchestrationStep(input: OrchestrateRerunInput, deps: OrchestratorDeps = defaultDeps, notesDir = getNotesDir()): Promise<OrchestrationReconcileResult> {
  const record = getOrchestration(input.taskId, notesDir);
  const task = await deps.findTask(input.taskId, record.taskDate);
  if (!task) throw new StoryboardError("That task is not in the active profile.", 404);
  if (task.done || task.abandonedAt) throw new StoryboardError("Reopen the task before re-running verification.", 409);
  if (isTaskOwnershipBlocked(task)) throw new StoryboardError("This task's ownership is pending or handed off and is read-only.", 409);
  await rerunVerification(input.taskId, input.step, input.idempotencyKey, notesDir);
  return reconcileOrchestration(input.taskId, deps, notesDir);
}

/** Reply to an open question with a question: log it in the note, then run the step again with it as guidance. */
export async function askBackOrchestration(input: OrchestrateAskBackInput, deps: OrchestratorDeps = defaultDeps, notesDir = getNotesDir()): Promise<OrchestrationReconcileResult> {
  const record = await askBackAuto(input.taskId, input.text, input.idempotencyKey, notesDir);
  try {
    updateTaskNoteSections({ taskId: input.taskId, date: record.taskDate }, { op: "append_log", message: `John asked back: ${input.text.slice(0, 500)}` });
  } catch (error) {
    // The run still gets his words; the log line is a convenience.
    console.warn("[storyboard] couldn't log the ask-back", error instanceof Error ? error.message : error);
  }
  return reconcileOrchestration(input.taskId, deps, notesDir);
}
