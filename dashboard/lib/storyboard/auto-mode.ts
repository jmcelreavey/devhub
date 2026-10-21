import { randomUUID } from "node:crypto";
import path from "node:path";
import { AgentDispatchError, type AgentDispatchInput } from "@/lib/agent-runs/dispatch";
import { feedbackPushRules } from "@/lib/tasks/feedback-prompt";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import type { AgentRun } from "@/lib/agent-runs/store";
import type { TaskQaInput, TaskQaPreparation } from "@/lib/qa/service";
import { buildAutoDraftPrPrompt, buildAutoFixPrompt, buildAutoImplementPrompt } from "@/lib/tasks/auto-prompts";
import { buildTaskPlanPrompt } from "@/lib/tasks/implement-prompt";
import { buildImplementReviewPrompt } from "@/lib/tasks/implement-review-prompt";
import type { TaskAgentRunStatus } from "@/lib/tasks/task-agent-runs";
import type { Task } from "@/lib/tasks/types";
import type { TaskNoteStatus } from "@shared/task-note/meta.ts";
import type { TaskNoteView } from "@shared/task-note/sections.ts";
import type { ModelTier } from "./model-tiers-shared";
import { autoLaunchCheckout, autoLaunchPrompt, autoStepChoice, autoTierDispatch } from "./launch-options";
import { tierStepForPhase } from "./auto-tiers";
import { StoryboardError } from "./errors";
import { columnForPhase, stepForPhase } from "./auto-phase";
import { AUTO_PHASE_LABEL } from "./orchestration";
import { mutateOrchestration, readOrchestration, withOrchestrationWorkLock } from "./orchestration-store";
import type { AutoPhase, AutoRun, AutoState, AutoWaiting, OrchestrationCheckoutChoice, OrchestrationRecord } from "./types";

/**
 * Auto mode (M1): once John starts a task on auto it advances on its own:
 *
 *   plan → (no open questions) before-video → implement → draft PR
 *        → review + Jev QA → fix (at most `maxRounds`) → Ready for review
 *
 * It stops at Needs you on open questions, a failed run, or bugs left after
 * the last fix round, and carries on when the questions are answered (the
 * next poll sees them resolved) or John presses Retry.
 *
 * The state machine lives in the orchestration record (`record.auto`), and
 * every transition is a compare-and-set under the record's lock, so a second
 * poller, a double click or an app restart never skips or repeats a step.
 * Dispatch request IDs are derived from phase, round and attempt, so a
 * dispatch whose result was lost (crash between dispatch and write) returns
 * the same run on the next tick instead of starting a second one.
 */

export const AUTO_MAX_ROUNDS = 2;
export const HEAVY_JOB_LIMIT = 2;

export { AUTO_PHASE_LABEL, columnForPhase, stepForPhase };

/** Agent phases have a run of their own; baseline and verify are driven from here. */
const AGENT_PHASES: AutoPhase[] = ["plan", "implement", "draft-pr", "fix"];

export function newAutoState(origin: string, pauseAfterPlan?: boolean): AutoState {
  return { cycleId: randomUUID(), ...(pauseAfterPlan !== undefined ? { pauseAfterPlan } : {}), phase: "plan", round: 0, maxRounds: AUTO_MAX_ROUNDS, attempt: 0, origin, runs: [] };
}

export interface AutoQaResult {
  finished: boolean;
  bugs: number;
  /** Failed goals and runner errors, for the fix prompt. */
  failing: string[];
}

export interface AutoTierPick {
  tier?: ModelTier;
  reason?: string;
}

export interface AutoDeps {
  dispatch: (input: AgentDispatchInput, options?: { defer?: boolean }) => Promise<AgentRun>;
  findTask: (taskId: string, taskDate: string) => Promise<Task | null>;
  noteView: (task: Task, taskDate: string) => { view: TaskNoteView | null; markdown: string | null; notePath: string };
  runStatus: (taskId: string, runId: string) => TaskAgentRunStatus | undefined;
  /** The task's agent runs, so a run John started or resumed outside auto mode (Paseo, a follow-up) can be adopted. */
  taskRuns?: (taskId: string) => Array<{ runId: string; role?: string; status: TaskAgentRunStatus; startedAt: string }>;
  /** Where a finished run did its work (its worktree, or the checkout). */
  runWork: (runId: string) => AutoState["work"] | null;
  prepareTaskQa: (input: TaskQaInput, notesDir: string) => TaskQaPreparation;
  qaResult: (qaRunId: string) => Promise<AutoQaResult | null>;
  activeHeavyJobs: () => number;
  activeQaJobs: () => number;
  setNoteStatus: (task: Task, taskDate: string, status: TaskNoteStatus) => void;
  /** Checkout vs worktree for the implementation run. */
  chooseCheckout: (task: Task, taskDate: string, cwd: string, ownRunIds: readonly string[]) => Promise<OrchestrationCheckoutChoice>;
  /** Cancel a run that landed after John switched to Manual. */
  cancelRun: (runId: string) => Promise<unknown>;
  /** Is this a UI change? (item: UI detection) */
  detectUi: (input: { task: Task; markdown: string | null; work?: AutoState["work"] }) => Promise<{ detected: boolean; reason: string }>;
  /** The tier a phase runs on, and why when it differs from the step's saved tier. */
  pickTier: (input: { record: OrchestrationRecord; phase: AutoPhase; work?: AutoState["work"] }) => Promise<AutoTierPick>;
  /** A URL for Jev, starting the repo's preview when its config allows; null skips Jev with the reason. */
  resolvePreview: (input: { record: OrchestrationRecord; task: Task; markdown: string | null; cwd?: string }) => Promise<PreviewTarget>;
  stopPreview: (taskId: string) => void;
  /** Release disposable checkout/builds only after PR review and QA finish. */
  cleanupWork?: (taskId: string) => Promise<void>;
  /** Did the implementation change any files (commits or working tree) since its base? Null when git can't say. A report-only task changes none. */
  workChanged?: (work: NonNullable<AutoState["work"]>) => Promise<boolean | null>;
  /** The pinned checkout may have been cleaned up since. Put it back from its branch when it can be. */
  restoreWork?: (work: NonNullable<AutoState["work"]>) => Promise<"present" | "restored" | "gone">;
}

const LIVE_STATUSES: TaskAgentRunStatus[] = ["queued", "running"];
const QUEUED_REASON = "Queued: two heavy jobs (agents or Jev) are already running.";
const PASEO_RETRY_REASON = "Couldn't reach Paseo just now. Trying again.";
const PASEO_RETRY_MS = 3 * 60_000;
const NO_CODE_CHANGED = "No code changed";
const QA_QUEUED_REASON = "Queued: another Jev QA run owns the browser.";

function isAdvancing(record: OrchestrationRecord | null): record is OrchestrationRecord & { auto: AutoState } {
  return Boolean(record?.auto) && !record!.terminal && !["paused-manual", "stopped", "ready-for-review", "pr-created"].includes(record!.status);
}

function currentRun(auto: AutoState): AutoRun | undefined {
  return auto.runs.filter((run) => run.feedbackKey === auto.feedbackKey && run.phase === auto.phase && run.round === auto.round && run.attempt === auto.attempt).at(-1);
}

/** What tells this run from the same step's earlier ones in Paseo's list: its retry or fix round. */
function runLabel(auto: AutoState): string | undefined {
  if (auto.phase === "fix") return `fix round ${auto.round}${auto.attempt ? `, retry ${auto.attempt}` : ""}`;
  if (auto.phase === "draft-pr") return auto.attempt ? `opening PR, retry ${auto.attempt}` : "opening PR";
  return auto.attempt ? `retry ${auto.attempt}` : undefined;
}

function requestIdFor(taskId: string, auto: AutoState): string {
  return `storyboard-auto-${taskId}${auto.cycleId ? `-${auto.cycleId}` : ""}-${auto.phase}-r${auto.round}-a${auto.attempt}${auto.feedbackKey ? `-f${auto.feedbackKey}` : ""}`;
}

function openQuestions(view: TaskNoteView | null): number {
  return view?.questions.filter((question) => !question.resolved).length ?? 0;
}

function openBugs(view: TaskNoteView | null): Array<{ title: string; details?: string }> {
  return view?.bugs.filter((bug) => bug.status === "open") ?? [];
}

type Guard = (record: OrchestrationRecord & { auto: AutoState }) => boolean;

/** Compare-and-set: `guard` re-checks the state this decision was made on, under the lock. */
async function transition(
  taskId: string,
  guard: Guard,
  change: (record: OrchestrationRecord & { auto: AutoState }) => void,
  notesDir: string,
): Promise<boolean> {
  let applied = false;
  await mutateOrchestration(taskId, null, (current) => {
    if (!isAdvancing(current) || !guard(current)) return null;
    change(current);
    applied = true;
    return current;
  }, notesDir);
  return applied;
}

function samePhase(auto: AutoState): Guard {
  return (record) => record.auto.cycleId === auto.cycleId && record.auto.feedbackKey === auto.feedbackKey && record.auto.phase === auto.phase && record.auto.round === auto.round && record.auto.attempt === auto.attempt;
}

function wait(record: OrchestrationRecord & { auto: AutoState }, waiting: Omit<AutoWaiting, "at">): void {
  record.auto.waiting = { ...waiting, at: new Date().toISOString() };
  if (waiting.kind === "queued") {
    record.status = "starting";
    record.lastError = waiting.reason;
  } else {
    record.status = "needs-you";
    if (waiting.kind === "plan-approval") delete record.lastError;
    else record.lastError = waiting.reason;
  }
}

function enter(record: OrchestrationRecord & { auto: AutoState }, phase: AutoPhase, patch: Partial<AutoState> = {}): void {
  Object.assign(record.auto, patch);
  record.auto.phase = phase;
  delete record.auto.waiting;
  record.executionStep = stepForPhase(phase);
  if (phase === "ready") {
    record.status = "ready-for-review";
    const verify = record.auto.verify;
    if (verify?.qaSkipped === NO_CODE_CHANGED && !verify.reviewDone) {
      record.lastError = "Auto mode finished. No code changed, so there is no PR, review or QA. The result is in the task note.";
      return;
    }
    const qa = verify?.qaDone ? "Jev QA passed" : verify?.qaSkipped ? `Jev QA didn't run (${verify.qaSkipped.replace(/\.$/, "")})` : "Jev QA not recorded";
    // Say what actually happened: "passed" for a skipped QA, or a review nobody can see, sent people looking for evidence that wasn't there.
    record.lastError = `Auto mode finished. ${verify?.reviewDone ? "Review done" : "No review recorded"}; ${qa}. Check the work before you rely on it.`;
  } else {
    record.status = "starting";
    delete record.lastError;
  }
}

export function safeNoteStatus(deps: AutoDeps, task: Task, taskDate: string, status: TaskNoteStatus): void {
  try {
    deps.setNoteStatus(task, taskDate, status);
  } catch (error) {
    console.warn("[storyboard-auto] couldn't set the note status", error instanceof Error ? error.message : error);
  }
}

interface StepContext {
  record: OrchestrationRecord & { auto: AutoState };
  task: Task;
  deps: AutoDeps;
  notesDir: string;
  executes: Array<() => Promise<void>>;
}

/**
 * Park the task at `waiting`. Everything but a queue slot needs John, so the card
 * also moves to Needs you in its note, as it does for the stops that already did
 * (questions, a failed run, the fix-round cap). Without that a failed start sat in
 * the column of the step before it, under a red bar.
 */
async function stop(ctx: StepContext, guard: Guard, waiting: Omit<AutoWaiting, "at">, also?: (record: OrchestrationRecord & { auto: AutoState }) => void): Promise<boolean> {
  const applied = await transition(ctx.record.taskId, guard, (current) => { also?.(current); wait(current, waiting); }, ctx.notesDir);
  if (applied && waiting.kind !== "queued") safeNoteStatus(ctx.deps, ctx.task, ctx.record.taskDate, "needs-you");
  return applied;
}

/** Why a task is no longer work in flight: ticked done, or abandoned (the board hides it too). */
function closedReason(task: Task): string | null {
  if (task.done) return "The task was ticked done, so auto mode stopped.";
  if (task.abandonedAt) return "The task was abandoned, so auto mode stopped.";
  return null;
}

/** Dispatch the agent run for the current phase (plan, implement, draft PR or fix). */
async function dispatchPhase(ctx: StepContext): Promise<boolean> {
  const { record, task, deps, notesDir } = ctx;
  const auto = record.auto;
  if (deps.activeHeavyJobs() >= HEAVY_JOB_LIMIT) {
    if (auto.waiting?.kind === "queued") return false;
    return transition(record.taskId, samePhase(auto), (current) => wait(current, { kind: "queued", reason: QUEUED_REASON }), notesDir);
  }
  const checkoutCwd = record.repo?.cwd;
  if (!checkoutCwd) {
    return stop(ctx, samePhase(auto), { kind: "failure", reason: "No checkout to run in. Answer the repo question first." });
  }
  const prompt = { origin: auto.origin, taskId: task.id, date: record.taskDate, repoName: record.repo?.name, jiraKey: task.jiraKey };
  const work = auto.work;
  const followUp = work ? { cwd: work.worktree ? work.worktree.path : work.cwd, worktree: false, inherit: { ...(work.worktree ? { worktree: work.worktree } : {}), ...(work.baseSha ? { baseSha: work.baseSha } : {}) } } : null;
  let request: Pick<AgentDispatchInput, "prompt" | "cwd" | "title" | "worktree" | "inherit" | "prepareCheckout"> & { action: string };
  let choice: OrchestrationCheckoutChoice | undefined;
  switch (auto.phase) {
    case "plan": {
      if (auto.feedbackBrief && followUp) {
        request = { action: "plan", prompt: buildTaskPlanPrompt({ ...prompt, pauseAfterPlan: auto.pauseAfterPlan, cwd: followUp.cwd }), ...followUp, title: `Plan feedback for ${task.text}` };
        break;
      }
      // A retried or resumed plan; the first one is dispatched by Start on auto (orchestrator.ts).
      choice = autoLaunchCheckout(await deps.chooseCheckout(task, record.taskDate, checkoutCwd, record.runIds), record.launchOptions);
      const isolated = choice.mode === "worktree";
      request = { action: "plan", prompt: buildTaskPlanPrompt({ ...prompt, pauseAfterPlan: auto.pauseAfterPlan, ...(isolated ? { isolated } : { cwd: checkoutCwd }) }), cwd: checkoutCwd, worktree: isolated, prepareCheckout: record.launchOptions?.worktree === false, title: `Plan ${task.text}` };
      break;
    }
    case "implement": {
      if (auto.feedbackBrief && followUp) {
        request = { action: "implement", prompt: buildAutoFixPrompt({ ...prompt, cwd: followUp.cwd, round: auto.round, maxRounds: auto.maxRounds, findings: [auto.feedbackBrief, feedbackPushRules(work?.worktree?.branch)], branch: work?.worktree?.branch }), ...followUp, title: `Address feedback for ${task.text}` };
        break;
      }
      // Build decides checkout vs worktree once per run; a retried Build keeps that decision so the label stays put.
      const decided = auto.runs.some((entry) => entry.phase === "implement") ? record.checkout : undefined;
      const inspected = decided?.mode === "worktree" ? decided : autoLaunchCheckout(await deps.chooseCheckout(task, record.taskDate, checkoutCwd, record.runIds), record.launchOptions);
      if (decided?.mode === "checkout" && inspected.mode === "worktree") {
        return stop(ctx, samePhase(auto), { kind: "failure", reason: `Build cannot safely reuse its checkout: ${inspected.reason}. Resolve this before retrying, or switch to Manual.` });
      }
      choice = decided ?? inspected;
      const isolated = choice.mode === "worktree";
      const previous = auto.runs.filter((entry) => entry.phase === "implement").at(-1);
      const previousWork = previous ? deps.runWork(previous.runId) : null;
      request = { action: "implement", ...(choice.mode === "checkout" && previousWork?.baseSha ? { inherit: { baseSha: previousWork.baseSha } } : {}), prepareCheckout: record.launchOptions?.worktree === false, prompt: buildAutoImplementPrompt({ ...prompt, ...(record.launchOptions?.skipPlan ? { skipPlan: true } : {}), ...(isolated ? {} : { cwd: checkoutCwd }) }), cwd: checkoutCwd, worktree: isolated, title: `Implement ${task.text}` };
      break;
    }
    case "draft-pr":
      request = { action: "create-pr", prompt: buildAutoDraftPrPrompt({ ...prompt, cwd: followUp?.cwd ?? checkoutCwd, branch: work?.worktree?.branch }), title: `Open PR ${task.text}`, ...(followUp ?? { cwd: checkoutCwd, worktree: false }) };
      break;
    case "fix":
      request = {
        action: "implement",
        prompt: buildAutoFixPrompt({ ...prompt, cwd: followUp?.cwd ?? checkoutCwd, round: auto.round, maxRounds: auto.maxRounds, findings: auto.findings ?? [], branch: work?.worktree?.branch }),
        title: `Fix round ${auto.round} ${task.text}`,
        ...(followUp ?? { cwd: checkoutCwd, worktree: false }),
      };
      break;
    default:
      return false;
  }
  const step = tierStepForPhase(auto.phase);
  const override = autoStepChoice(record.launchOptions, step);
  const tier = override?.provider ? {} : await deps.pickTier({ record, phase: auto.phase, work });
  let run: AgentRun | null = null;
  let error: string | null = null;
  try {
    run = await deps.dispatch({
      requestId: requestIdFor(record.taskId, auto),
      provider: "",
      prompt: withRecoveryGuidance(step === "plan" || step === "implement" ? autoLaunchPrompt(request.prompt, record.launchOptions) : request.prompt, auto),
      cwd: request.cwd,
      title: request.title,
      worktree: request.worktree,
      prepareCheckout: request.prepareCheckout ?? false,
      ...(request.inherit ? { inherit: request.inherit } : {}),
      ...(tier.tier ? { tier: tier.tier } : {}),
      ...(tier.reason ? { tierReason: tier.reason } : {}),
      ...autoTierDispatch(record.tiers, step, tier, record.launchOptions),
      depth: 0,
      activity: { source: "interactive", action: request.action, taskId: task.id, taskDate: record.taskDate, ...(runLabel(auto) ? { label: runLabel(auto) } : {}), ...(record.repo?.name ? { repoName: record.repo.name } : {}) },
    }, { defer: true });
  } catch (caught) {
    if (!(caught instanceof AgentDispatchError)) console.error("[storyboard-auto] dispatch failed", caught);
    error = caught instanceof Error ? caught.message : String(caught);
  }
  if (!run) {
    const capacity = /capacity|already running|too many/i.test(error ?? "");
    // A connection that dropped for a moment (Paseo busy with a chat John stepped into) is not a failed step. Try again each
    // tick for a few minutes before calling it one, so the card never says Paseo is down while it is running.
    const unreachable = /Paseo/i.test(error ?? "") && /(set up|isn't running|didn't answer|could not connect|couldn't connect|unavailable)/i.test(error ?? "");
    const retryingSince = auto.waiting?.kind === "queued" && auto.waiting.reason === PASEO_RETRY_REASON ? Date.parse(auto.waiting.at) : Date.now();
    if (unreachable && Date.now() - retryingSince < PASEO_RETRY_MS) {
      const queued = await stop(ctx, samePhase(auto), { kind: "queued", reason: PASEO_RETRY_REASON });
      // Keep the first attempt's time so the clock runs across ticks.
      await transition(record.taskId, samePhase(auto), (current) => { if (current.auto.waiting?.reason === PASEO_RETRY_REASON) current.auto.waiting.at = new Date(retryingSince).toISOString(); }, notesDir);
      return queued;
    }
    return stop(ctx, samePhase(auto), capacity
      ? { kind: "queued", reason: QUEUED_REASON }
      : { kind: "failure", reason: `Couldn't start ${AUTO_PHASE_LABEL[auto.phase]}: ${error ?? "the run did not start."}` });
  }
  const runId = run.spec.id;
  let manual = false;
  const applied = await transition(record.taskId, (current) => samePhase(auto)(current) || current.auto.feedbackKey === auto.feedbackKey && current.auto.runs.some((entry) => entry.runId === runId), (current) => {
    if (!current.runIds.includes(runId)) current.runIds.push(runId);
    if (!current.auto.runs.some((entry) => entry.runId === runId)) {
      current.auto.runs.push({ runId, phase: auto.phase, round: auto.round, attempt: auto.attempt, ...(auto.feedbackKey ? { feedbackKey: auto.feedbackKey } : {}), ...(tier.tier ? { tier: tier.tier } : {}), ...(tier.reason ? { tierReason: tier.reason } : {}), at: new Date().toISOString() });
    }
    if (choice) current.checkout = choice;
    delete current.auto.waiting;
    current.status = "running";
    delete current.lastError;
  }, notesDir);
  if (!applied) {
    // John switched to Manual while the dispatch was in flight: Manual wins, the run stops.
    const latest = readOrchestration(record.taskId, notesDir);
    manual = latest?.status === "paused-manual";
    if (manual) {
      await mutateOrchestration(record.taskId, null, (current) => {
        if (!current || current.runIds.includes(runId)) return null;
        current.runIds.push(runId);
        return current;
      }, notesDir);
      await deps.cancelRun(runId).catch(() => undefined);
    }
    return false;
  }
  safeNoteStatus(deps, task, record.taskDate, columnForPhase(auto.phase));
  return true;
}

/** The current agent phase's run finished: decide where auto mode goes next. */
async function afterRun(ctx: StepContext, run: AutoRun): Promise<boolean> {
  const { record, task, deps, notesDir } = ctx;
  const auto = record.auto;
  const note = deps.noteView(task, record.taskDate);
  const questions = openQuestions(note.view);
  if (questions > 0) {
    // A plan with open questions is normal; the implementer reads the answers. A blocked implement or fix re-runs once they're answered.
    const next: AutoPhase = auto.phase === "plan" ? "baseline" : auto.phase;
    const applied = await transition(record.taskId, samePhase(auto), (current) => wait(current, {
      kind: "questions",
      reason: `${questions} open question${questions === 1 ? "" : "s"} in the note after ${AUTO_PHASE_LABEL[auto.phase]}. Answer ${questions === 1 ? "it" : "them"} and auto mode carries on.`,
      next,
    }), notesDir);
    if (applied) safeNoteStatus(deps, task, record.taskDate, "needs-you");
    return applied;
  }
  switch (auto.phase) {
    case "plan":
      if (auto.pauseAfterPlan) return awaitPlanApproval(ctx);
      return transition(record.taskId, samePhase(auto), (current) => enter(current, "baseline", { attempt: 0 }), notesDir);
    case "implement": {
      const work = deps.runWork(run.runId) ?? (record.repo?.cwd ? { cwd: record.repo.cwd } : undefined);
      // An investigation or report changes no files: a PR, a code review and QA would have nothing to look at, so it is done.
      if (!auto.feedbackBrief && work && await deps.workChanged?.(work) === false) {
        const finished = await transition(record.taskId, samePhase(auto), (current) => enter(current, "ready", { attempt: 0, work, verify: { qaSkipped: NO_CODE_CHANGED } }), notesDir);
        if (finished) { deps.stopPreview(record.taskId); safeNoteStatus(deps, task, record.taskDate, "ready-for-review"); }
        return finished;
      }
      return transition(record.taskId, samePhase(auto), (current) => enter(current, auto.feedbackBrief ? "verify" : "draft-pr", { attempt: 0, ...(auto.feedbackBrief ? { verify: {} } : {}), ...(work ? { work } : {}) }), notesDir);
    }
    case "draft-pr":
    case "fix":
      return transition(record.taskId, samePhase(auto), (current) => enter(current, "verify", { attempt: 0, verify: {} }), notesDir);
    default:
      return false;
  }
}

export interface PreviewTarget {
  url: string | null;
  /** "starting": DevHub is bringing the repo's preview up; check again next tick. */
  state: "url" | "started" | "starting" | "none";
  reason: string;
}

/** Is this a UI change, and can Jev reach it? Cached on the record; the card toggle overrides detection. */
async function uiAndPreview(ctx: StepContext, markdown: string | null): Promise<PreviewTarget & { ui: boolean }> {
  const { record, task, deps, notesDir } = ctx;
  const auto = record.auto;
  const detected = await deps.detectUi({ task, markdown, work: auto.work });
  const ui = auto.ui?.override ?? detected.detected;
  if (!auto.ui || auto.ui.detected !== detected.detected || auto.ui.reason !== detected.reason) {
    await transition(record.taskId, () => true, (current) => {
      current.auto.ui = { ...detected, ...(current.auto.ui?.override !== undefined ? { override: current.auto.ui.override } : {}) };
    }, notesDir);
  }
  if (!ui) return { ui, url: null, state: "none", reason: auto.ui?.override === false ? "Marked not a UI change on the card." : detected.reason };
  const preview = await deps.resolvePreview({ record, task, markdown, cwd: auto.work ? (auto.work.worktree?.path ?? auto.work.cwd) : record.repo?.cwd });
  const prior = auto.preview;
  if (!prior || prior.state !== preview.state || prior.url !== (preview.url ?? undefined) || prior.reason !== preview.reason) {
    await transition(record.taskId, () => true, (current) => {
      current.auto.preview = { state: preview.state, ...(preview.url ? { url: preview.url } : {}), reason: preview.reason };
    }, notesDir);
  }
  return { ui, ...preview };
}

/** Start a Jev run (baseline or verify). Returns the run id, a skip reason, or null when it has to wait for a slot. */
async function startQa(ctx: StepContext, baseline: boolean, markdown: string | null, url: string): Promise<{ runId: string } | { skipped: string } | null> {
  const { record, task, deps, notesDir, executes } = ctx;
  if (deps.activeQaJobs() >= 1) {
    if (record.auto.waiting?.kind !== "queued") await transition(record.taskId, samePhase(record.auto), (current) => wait(current, { kind: "queued", reason: QA_QUEUED_REASON }), notesDir);
    return null;
  }
  if (deps.activeHeavyJobs() >= HEAVY_JOB_LIMIT) {
    if (record.auto.waiting?.kind !== "queued") await transition(record.taskId, samePhase(record.auto), (current) => wait(current, { kind: "queued", reason: QUEUED_REASON }), notesDir);
    return null;
  }
  let prepared: TaskQaPreparation;
  try {
    prepared = deps.prepareTaskQa({
      task, noteMarkdown: markdown, targetUrl: url,
      sourceRunId: requestIdFor(record.taskId, record.auto),
      ...(baseline ? { baseline: true } : {}),
    }, notesDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already active|owns this workspace/i.test(message)) return null;
    return { skipped: `Jev couldn't start: ${message}` };
  }
  if (prepared.skipped) return { skipped: prepared.reason };
  if (prepared.execute) executes.push(prepared.execute);
  return { runId: prepared.run.id };
}

async function stepBaseline(ctx: StepContext): Promise<boolean> {
  const { record, task, deps, notesDir } = ctx;
  const auto = record.auto;
  const toImplement = async () => {
    const applied = await transition(record.taskId, samePhase(auto), (current) => enter(current, "implement", { attempt: 0 }), notesDir);
    // The before video ran against the base checkout; verify starts its own preview in the task's checkout.
    if (applied) deps.stopPreview(record.taskId);
    return applied;
  };
  if (auto.baselineQaRunId) {
    const result = await deps.qaResult(auto.baselineQaRunId);
    if (result && !result.finished) return false;
    return toImplement();
  }
  const markdown = deps.noteView(task, record.taskDate).markdown;
  const verification = markdown?.match(/^##\s+Verification\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1];
  if (!/^\s*(?:-\s+)?Baseline capture:\s*required\s*$/im.test(verification ?? "")) return toImplement();
  const target = await uiAndPreview(ctx, markdown);
  if (target.ui && target.state === "starting") return false;
  if (!target.ui || !target.url) return toImplement();
  const started = await startQa(ctx, true, markdown, target.url);
  if (!started) return false;
  if ("skipped" in started) return toImplement();
  return transition(record.taskId, samePhase(auto), (current) => {
    current.auto.baselineQaRunId = started.runId;
    delete current.auto.waiting;
    current.status = "running";
    current.lastError = "Recording the before video.";
  }, notesDir);
}

async function stepVerify(ctx: StepContext): Promise<boolean> {
  const { record, task, deps, notesDir } = ctx;
  const auto = record.auto;
  const verify = auto.verify ?? {};

  // 1. Code review run.
  if (!verify.reviewRunId) {
    if (deps.activeHeavyJobs() >= HEAVY_JOB_LIMIT) {
      if (auto.waiting?.kind === "queued") return false;
      return transition(record.taskId, samePhase(auto), (current) => wait(current, { kind: "queued", reason: QUEUED_REASON }), notesDir);
    }
    const work = auto.work ?? (record.repo?.cwd ? { cwd: record.repo.cwd } : undefined);
    if (!work) return stop(ctx, samePhase(auto), { kind: "failure", reason: "No checkout to review." });
    const cwd = work.worktree?.path ?? work.cwd;
    const override = autoStepChoice(record.launchOptions, "review");
    const tier = override?.provider ? {} : await deps.pickTier({ record, phase: "verify", work });
    let run: AgentRun | null = null;
    let error: string | null = null;
    try {
      run = await deps.dispatch({
        requestId: `${requestIdFor(record.taskId, auto)}-review`,
        provider: "",
        prompt: withRecoveryGuidance(buildImplementReviewPrompt({
          origin: auto.origin, taskId: task.id, date: record.taskDate, taskText: task.text, cwd,
          notePath: `pr-reviews/storyboard-${task.id.slice(0, 8)}-r0`,
          ...(record.repo?.name ? { repoName: record.repo.name } : {}), ...(task.jiraKey ? { jiraKey: task.jiraKey } : {}),
          ...(work.worktree?.branch ? { branch: work.worktree.branch } : {}),
        }), auto),
        cwd,
        worktree: false,
        inherit: { ...(work.worktree ? { worktree: work.worktree } : {}), ...(work.baseSha ? { baseSha: work.baseSha } : {}) },
        title: `Review ${task.text}`,
        ...(tier.tier ? { tier: tier.tier } : {}),
        ...(tier.reason ? { tierReason: tier.reason } : {}),
        ...autoTierDispatch(record.tiers, "review", tier, record.launchOptions),
        depth: 0,
        activity: { source: "interactive", action: "review", taskId: task.id, taskDate: record.taskDate, ...(record.repo?.name ? { repoName: record.repo.name } : {}) },
      }, { defer: true });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    if (!run) {
      return stop(ctx, samePhase(auto), /capacity/i.test(error ?? "")
        ? { kind: "queued", reason: QUEUED_REASON }
        : { kind: "failure", reason: `Couldn't start the review: ${error ?? "the run did not start."}` });
    }
    const runId = run.spec.id;
    const applied = await transition(record.taskId, samePhase(auto), (current) => {
      if (!current.runIds.includes(runId)) current.runIds.push(runId);
      if (!current.auto.runs.some((entry) => entry.runId === runId)) {
        current.auto.runs.push({ runId, phase: "verify", round: auto.round, attempt: auto.attempt, ...(auto.feedbackKey ? { feedbackKey: auto.feedbackKey } : {}), ...(tier.tier ? { tier: tier.tier } : {}), ...(tier.reason ? { tierReason: tier.reason } : {}), at: new Date().toISOString() });
      }
      current.auto.verify = { ...(current.auto.verify ?? {}), reviewRunId: runId };
      delete current.auto.waiting;
      current.status = "running";
      delete current.lastError;
    }, notesDir);
    if (applied) safeNoteStatus(deps, task, record.taskDate, columnForPhase("verify"));
    else if (readOrchestration(record.taskId, notesDir)?.status === "paused-manual") {
      await mutateOrchestration(record.taskId, null, (current) => {
        if (!current || current.runIds.includes(runId)) return null;
        current.runIds.push(runId);
        return current;
      }, notesDir);
      await deps.cancelRun(runId);
    }
    return applied;
  }

  let changed = false;
  if (!verify.reviewDone) {
    const status = deps.runStatus(record.taskId, verify.reviewRunId);
    if (status === "done") {
      changed = await transition(record.taskId, samePhase(auto), (current) => { current.auto.verify = { ...(current.auto.verify ?? {}), reviewDone: true }; }, notesDir);
    } else if (status && !LIVE_STATUSES.includes(status)) {
      return stop(ctx, samePhase(auto), { kind: "failure", reason: `The review run ${status}. Retry to run it again.` });
    }
  }

  // 2. Jev QA, alongside the review when there's a slot (one Jev run at a time).
  if (!verify.qaRunId && !verify.qaSkipped) {
    const markdown = deps.noteView(task, record.taskDate).markdown;
    const target = await uiAndPreview(ctx, markdown);
    if (target.ui && target.state === "starting") return changed;
    if (!target.ui || !target.url) {
      const reason = !target.ui ? `Jev skipped: not a UI change (${target.reason}).` : `No preview: ${target.reason}`;
      return transition(record.taskId, samePhase(auto), (current) => { current.auto.verify = { ...(current.auto.verify ?? {}), qaSkipped: reason }; }, notesDir) || changed;
    }
    const started = await startQa(ctx, false, markdown, target.url);
    if (!started) return changed;
    return transition(record.taskId, samePhase(auto), (current) => {
      current.auto.verify = { ...(current.auto.verify ?? {}), ...("runId" in started ? { qaRunId: started.runId } : { qaSkipped: started.skipped }) };
      if (current.auto.waiting?.kind === "queued") delete current.auto.waiting;
      if (current.status === "starting") current.status = "running";
    }, notesDir) || changed;
  }
  let qaBugs = verify.qaBugs ?? 0;
  let qaFailing: string[] = [];
  if (verify.qaRunId && !verify.qaDone) {
    const result = await deps.qaResult(verify.qaRunId);
    if (!result || !result.finished) return changed;
    qaBugs = result.bugs;
    qaFailing = result.failing;
    changed = await transition(record.taskId, samePhase(auto), (current) => { current.auto.verify = { ...(current.auto.verify ?? {}), qaDone: true, qaBugs: result.bugs }; }, notesDir) || changed;
  } else if (verify.qaRunId) {
    qaFailing = (await deps.qaResult(verify.qaRunId))?.failing ?? [];
  }
  const fresh = readOrchestration(record.taskId, notesDir);
  const done = fresh?.auto?.verify;
  if (!done?.reviewDone || !(done.qaDone || done.qaSkipped)) return changed;

  // 3. Decide: ready, another fix round, or Needs you at the cap.
  const bugs = openBugs(deps.noteView(task, record.taskDate).view);
  const total = bugs.length + qaBugs;
  if (total === 0) {
    const applied = await transition(record.taskId, samePhase(auto), (current) => enter(current, "ready"), notesDir);
    if (applied) {
      deps.stopPreview(record.taskId);
      safeNoteStatus(deps, task, record.taskDate, "ready-for-review");
      if (deps.cleanupWork) ctx.executes.push(() => deps.cleanupWork!(record.taskId));
    }
    return applied;
  }
  const findings = [
    ...bugs.map((bug) => `Review: ${bug.title}${bug.details ? ` (${bug.details.slice(0, 200)})` : ""}`),
    ...qaFailing.map((goal) => `Jev QA: ${goal}`),
  ].slice(0, 40).map((line) => line.slice(0, 500));
  if (auto.round < auto.maxRounds) {
    return transition(record.taskId, samePhase(auto), (current) => enter(current, "fix", { round: current.auto.round + 1, attempt: 0, findings }), notesDir);
  }
  const applied = await transition(record.taskId, samePhase(auto), (current) => {
    current.auto.findings = findings;
    wait(current, { kind: "cap", reason: `${total} bug${total === 1 ? "" : "s"} left after ${auto.maxRounds} fix round${auto.maxRounds === 1 ? "" : "s"}. Retry for one more round, or take it from here.` });
  }, notesDir);
  if (applied) {
    deps.stopPreview(record.taskId);
    safeNoteStatus(deps, task, record.taskDate, "needs-you");
  }
  return applied;
}

const PHASE_ROLE: Partial<Record<AutoPhase, string>> = { plan: "plan", implement: "implement", "draft-pr": "implement", fix: "implement", verify: "review" };

/**
 * Auto mode stopped (a failed run, or questions) and John carried on in the agent himself.
 * When the stopped phase's run is live again, or a newer run for the same role appeared, take it
 * over: auto mode goes back to Running and follows it, then continues from its result as normal.
 */
async function adoptExternalRun(ctx: StepContext): Promise<boolean> {
  const { record, deps, notesDir } = ctx;
  const auto = record.auto;
  const role = PHASE_ROLE[auto.phase];
  if (!role || !deps.taskRuns || !["failure", "questions"].includes(auto.waiting?.kind ?? "")) return false;
  const since = Date.parse(auto.waiting!.at);
  const known = new Set(auto.runs.map((run) => run.runId));
  const current = currentRun(auto);
  const live = (status: TaskAgentRunStatus) => LIVE_STATUSES.includes(status);
  const candidate = deps.taskRuns(record.taskId)
    .filter((run) => (run.role ?? "implement") === role && live(run.status) && (!known.has(run.runId) ? Date.parse(run.startedAt) >= since : run.runId === current?.runId))
    .filter((run) => {
      if (run.runId === current?.runId || !auto.work || !["draft-pr", "fix", "verify"].includes(auto.phase)) return true;
      const work = deps.runWork(run.runId);
      return work && path.resolve(work.worktree?.path ?? work.cwd) === path.resolve(auto.work.worktree?.path ?? auto.work.cwd);
    })
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
  if (!candidate) return false;
  return transition(record.taskId, samePhase(auto), (next) => {
    if (!next.runIds.includes(candidate.runId)) next.runIds.push(candidate.runId);
    if (!next.auto.runs.some((run) => run.runId === candidate.runId)) next.auto.runs.push({ runId: candidate.runId, phase: auto.phase, round: auto.round, attempt: auto.attempt, ...(auto.feedbackKey ? { feedbackKey: auto.feedbackKey } : {}), at: new Date().toISOString() });
    if (auto.phase === "verify") next.auto.verify = { ...next.auto.verify, reviewRunId: candidate.runId, reviewDone: false };
    delete next.auto.waiting;
    next.status = "running";
    delete next.lastError;
  }, notesDir);
}

/** One transition at most. True when something changed and the caller should look again. */
async function stepOnce(record: OrchestrationRecord & { auto: AutoState }, deps: AutoDeps, notesDir: string, executes: Array<() => Promise<void>>): Promise<boolean> {
  const auto = record.auto;
  if (auto.phase === "ready") return false;
  const task = await deps.findTask(record.taskId, record.taskDate);
  if (!task) return false;
  if (isTaskOwnershipBlocked(task)) return false;
  const closed = closedReason(task);
  if (closed) {
    // Stop once: `paused` still counts as advancing, so an unconditional write here ran 8 times on every tick, for ever.
    return transition(record.taskId, (current) => !(current.status === "paused" && current.lastError === closed), (current) => {
      current.status = "paused";
      current.lastError = closed;
    }, notesDir);
  }
  const ctx: StepContext = { record, task, deps, notesDir, executes };

  if (record.status === "needs-you") {
    if (await adoptExternalRun(ctx)) return true;
    if (auto.waiting?.kind !== "questions") return false; // A failure or the cap waits for Retry.
    if (openQuestions(deps.noteView(task, record.taskDate).view) > 0) return false;
    const next = auto.waiting.next ?? auto.phase;
    if (auto.phase === "plan" && next === "baseline" && auto.pauseAfterPlan) return awaitPlanApproval(ctx);
    const bump = next === auto.phase;
    return transition(record.taskId, samePhase(auto), (current) => enter(current, next, { attempt: bump ? current.auto.attempt + 1 : 0 }), notesDir);
  }
  if (record.status === "paused") return false;

  if (auto.work && deps.restoreWork && ["baseline", "implement", "draft-pr", "verify", "fix"].includes(auto.phase)) {
    let restored: "present" | "restored" | "gone";
    try {
      restored = await deps.restoreWork(auto.work);
    } catch (error) {
      return stop(ctx, samePhase(auto), { kind: "failure", reason: `Couldn't restore this task's checkout: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000) });
    }
    if (restored === "gone") {
      // Drop the dead pin so the next attempt starts from the repo's own checkout instead of failing on a missing folder.
      return stop(ctx, samePhase(auto), { kind: "failure", reason: "This task's checkout and branch are gone. Retry to rebuild the implementation in a fresh checkout." }, (current) => {
        delete current.auto.work;
        delete current.auto.verify;
        delete current.auto.preview;
        // Verification of the repo checkout cannot replace the implementation that was lost.
        current.auto.phase = "implement";
        current.executionStep = "implement";
        current.auto.attempt = Math.max(0, ...current.auto.runs.filter((run) => run.phase === "implement" && run.round === current.auto.round).map((run) => run.attempt));
      });
    }
  }
  if (auto.phase === "baseline") return stepBaseline(ctx);
  if (auto.phase === "verify") return stepVerify(ctx);
  if (!AGENT_PHASES.includes(auto.phase)) return false;

  const run = currentRun(auto);
  if (!run) return dispatchPhase(ctx);
  const status = deps.runStatus(record.taskId, run.runId);
  if (!status || LIVE_STATUSES.includes(status)) return false;
  if (status === "done") return afterRun(ctx, run);
  // A run that stopped with questions left in the note is waiting on John, not failed: answering them re-runs the step.
  const asked = openQuestions(deps.noteView(task, record.taskDate).view);
  if (asked > 0) {
    return stop(ctx, samePhase(auto), {
      kind: "questions",
      reason: `${asked} open question${asked === 1 ? "" : "s"} in the note: the ${AUTO_PHASE_LABEL[auto.phase]} run stopped ${status === "paused" ? "waiting on an answer" : `(${status})`}. Answer ${asked === 1 ? "it" : "them"} and auto mode runs the step again.`,
      next: auto.phase,
    });
  }
  return stop(ctx, samePhase(auto), {
    kind: "failure",
    reason: status === "paused" ? `The ${AUTO_PHASE_LABEL[auto.phase]} run paused. Open it, or Retry to start it again on a higher tier.` : `The ${AUTO_PHASE_LABEL[auto.phase]} run ${status}. Retry to run it again on a higher tier.`,
  });
}

/**
 * Advance one task as far as it can go right now. Called by the poller and the
 * Storyboard's orchestration poll. Returns Jev runs to execute after responding.
 */
export async function advanceAuto(taskId: string, deps: AutoDeps, notesDir: string): Promise<Array<() => Promise<void>>> {
  return withOrchestrationWorkLock(taskId, notesDir, () => advanceAutoOnce(taskId, deps, notesDir));
}

async function advanceAutoOnce(taskId: string, deps: AutoDeps, notesDir: string): Promise<Array<() => Promise<void>>> {
  const executes: Array<() => Promise<void>> = [];
  for (let step = 0; step < 8; step++) {
    const record = readOrchestration(taskId, notesDir);
    if (!isAdvancing(record)) break;
    const changed = await stepOnce(record, deps, notesDir, executes);
    if (!changed) break;
  }
  return executes;
}

export interface RetryOutcome {
  record: OrchestrationRecord;
  changed: boolean;
}

/**
 * Retry from Needs you. A failure re-runs the phase (attempt + 1, which
 * escalates its tier); the cap grants one more fix round; answered questions
 * carry on. A record started before auto mode existed is upgraded here, so it
 * only advances when John asks it to.
 */
export async function retryAuto(taskId: string, idempotencyKey: string, origin: string, notesDir: string, planRunDone: (record: OrchestrationRecord) => boolean, guidance?: string): Promise<RetryOutcome> {
  let changed = false;
  let refusal: string | null = null;
  const result = await mutateOrchestration(taskId, idempotencyKey, (current) => {
    if (!current) return null;
    if (current.terminal || current.status === "stopped" || current.status === "ready-for-review") { refusal = "That task has finished on auto."; return null; }
    if (current.status === "paused-manual") { refusal = "The task is on Manual. Switch it back to Auto instead."; return null; }
    if (current.questions.some((question) => question.kind === "repo" && question.state === "open")) { refusal = "Pick the repo first."; return null; }
    if (!current.auto) {
      // Upgrade: a pre-M1 record continues from its finished plan run.
      const plan = current.runIds.at(-1);
      if (!plan) { refusal = "Nothing has run yet. Start on auto again."; return null; }
      current.auto = { ...newAutoState(origin), runs: [{ runId: plan, phase: "plan", round: 0, attempt: 0, at: current.updatedAt }] };
      if (!planRunDone(current)) { current.status = "running"; changed = true; return current; }
      enter(current as OrchestrationRecord & { auto: AutoState }, "baseline");
      changed = true;
      return current;
    }
    const auto = current.auto;
    const record = current as OrchestrationRecord & { auto: AutoState };
    switch (auto.waiting?.kind) {
      case "plan-approval":
        refusal = "Review the plan and choose Approve plan or Revise.";
        return null;
      case "cap":
        enter(record, "fix", { maxRounds: auto.maxRounds + 1, round: auto.round + 1, attempt: 0 });
        break;
      case "questions":
        if (auto.phase === "plan" && auto.pauseAfterPlan) { refusal = "Answer the open questions before reviewing the plan."; return null; }
        enter(record, auto.waiting.next ?? auto.phase, { attempt: (auto.waiting.next ?? auto.phase) === auto.phase ? auto.attempt + 1 : 0 });
        break;
      case "failure":
      case "queued":
        enter(record, auto.phase, { attempt: auto.attempt + 1, ...(auto.phase === "verify" ? { verify: {} } : {}) });
        break;
      default:
        if (current.status === "paused") { enter(record, auto.phase, { attempt: auto.attempt + 1 }); break; }
        refusal = "Auto mode isn't waiting on anything.";
        return null;
    }
    if (guidance) auto.recoveryGuidance = { text: guidance, phase: auto.phase, attempt: auto.attempt };
    changed = true;
    return current;
  }, notesDir);
  if (refusal) throw new StoryboardError(refusal, 409);
  return { record: result.record, changed };
}

/** Re-run the review or Jev QA on the same checkout. A new attempt, so the earlier run is not replayed. */
export async function rerunVerification(taskId: string, step: "qa" | "review", idempotencyKey: string, notesDir: string): Promise<OrchestrationRecord> {
  let refusal: string | null = null;
  const result = await mutateOrchestration(taskId, idempotencyKey, (current) => {
    if (!current?.auto) { refusal = "That task is not on auto."; return null; }
    const record = current as OrchestrationRecord & { auto: AutoState };
    if (record.terminal || record.status === "stopped" || record.status === "paused-manual") { refusal = "Switch the task to Auto first."; return null; }
    if (!["ready", "verify"].includes(record.auto.phase)) { refusal = "Review and QA only re-run once the work has reached verification."; return null; }
    if (record.status === "running" || record.status === "starting") { refusal = "Verification is already running."; return null; }
    const verify = { ...(record.auto.verify ?? {}) };
    if (step === "qa") {
      delete verify.qaRunId; delete verify.qaDone; delete verify.qaBugs; delete verify.qaSkipped;
      delete record.auto.preview;
    } else {
      delete verify.reviewRunId; delete verify.reviewDone;
    }
    enter(record, "verify", { attempt: record.auto.attempt + 1, verify });
    delete record.auto.findings;
    return record;
  }, notesDir);
  if (refusal) throw new StoryboardError(refusal, 409);
  return result.record;
}

/**
 * John answered a question with a question. The stopped step runs again with his words as guidance for
 * that attempt, and the open question stays open for the agent to answer in the note.
 */
export async function askBackAuto(taskId: string, text: string, idempotencyKey: string, notesDir: string): Promise<OrchestrationRecord> {
  let refusal: string | null = null;
  const result = await mutateOrchestration(taskId, idempotencyKey, (current) => {
    if (!current?.auto) { refusal = "Asking back needs a task on auto. Write the question in the note instead."; return null; }
    const record = current as OrchestrationRecord & { auto: AutoState };
    if (record.status !== "needs-you" || record.auto.waiting?.kind !== "questions") { refusal = "That task isn't waiting on an answer."; return null; }
    const phase = AGENT_PHASES.includes(record.auto.phase) ? record.auto.phase : "plan";
    enter(record, phase, { attempt: record.auto.attempt + 1 });
    record.auto.recoveryGuidance = {
      text: `John replied to your open question with a question of his own instead of an answer:\n\n${text}\n\nAnswer him in the task note (update the open question with your reply, or add_decision if it settles something). Keep the question open if you still need his decision.`,
      phase,
      attempt: record.auto.attempt,
    };
    return record;
  }, notesDir);
  if (refusal) throw new StoryboardError(refusal, 409);
  return result.record;
}

/** Card toggle: force (or clear) "this is a UI change". */
export async function setUiOverride(taskId: string, override: boolean | null, notesDir: string): Promise<OrchestrationRecord> {
  const result = await mutateOrchestration(taskId, null, (current) => {
    if (!current) return null;
    const auto = current.auto ?? null;
    if (!auto) return null;
    const ui = auto.ui ?? { detected: false, reason: "Not checked yet." };
    if (override === null) delete ui.override;
    else ui.override = override;
    auto.ui = ui;
    // A verify that skipped Jev only because of the old answer gets another look.
    if (auto.phase === "verify" && auto.verify?.qaSkipped && override) delete auto.verify.qaSkipped;
    return current;
  }, notesDir);
  return result.record;
}

/** Guidance belongs to one retry, not every later phase. */
export function withRecoveryGuidance(prompt: string, auto: AutoState): string {
  const guidance = auto.recoveryGuidance;
  return guidance && guidance.phase === auto.phase && guidance.attempt === auto.attempt
    ? `${prompt}\n\nUser guidance for this retry:\n${guidance.text}` : prompt;
}

/** Hold before baseline or implementation; answering questions never approves a plan. */
async function awaitPlanApproval(ctx: StepContext): Promise<boolean> {
  const applied = await transition(ctx.record.taskId, samePhase(ctx.record.auto), (current) => {
    wait(current, { kind: "plan-approval", reason: "Plan ready. Approve it to continue on Auto, or request a revision." });
  }, ctx.notesDir);
  if (applied) safeNoteStatus(ctx.deps, ctx.task, ctx.record.taskDate, "needs-you");
  return applied;
}

/** Compare the exact plan run under the lock so a stale panel cannot approve a revision. */
export async function decideAutoPlan(input: import("./schema").OrchestratePlanDecisionInput, deps: AutoDeps, notesDir: string): Promise<OrchestrationRecord> {
  const result = await mutateOrchestration(input.taskId, input.idempotencyKey, (current) => {
    if (!current?.auto || current.status !== "needs-you" || current.auto.waiting?.kind !== "plan-approval" || current.auto.phase !== "plan" || current.terminal) {
      throw new StoryboardError("This task is no longer waiting for plan approval. Refresh its details.", 409);
    }
    const record = current as OrchestrationRecord & { auto: AutoState };
    const run = currentRun(record.auto);
    if (run?.runId !== input.planRunId || deps.runStatus(current.taskId, input.planRunId) !== "done") throw new StoryboardError("The plan changed. Refresh and review the latest plan.", 409);
    if (input.decision === "approve") {
      enter(record, "baseline", { attempt: 0 });
    } else {
      if (!input.guidance?.trim()) throw new StoryboardError("Describe what the agent should revise.", 400);
      enter(record, "plan", { attempt: record.auto.attempt + 1 });
      record.auto.recoveryGuidance = { text: input.guidance, phase: "plan", attempt: record.auto.attempt };
    }
    return record;
  }, notesDir);
  return result.record;
}
