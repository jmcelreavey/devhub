import { TASK_NOTE_STATUS_LABEL, type TaskNoteStatus } from "@shared/task-note/meta.ts";
import { mutate } from "swr";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { ORCHESTRATIONS_KEY } from "@/lib/storyboard/use-orchestrations";
import { TASK_AGENT_RUNS_KEY } from "@/lib/tasks/use-task-agent-runs";
import { runTaskAction, type ActionResult } from "@/lib/storyboard/task-action";
import type { ModelTierSettings } from "@/lib/storyboard/model-tiers-shared";
import type { OrchestrationSummary } from "@/lib/storyboard/orchestration";
import { profileHeaders } from "@/lib/tasks/profile-scope";
import type { AutoLaunchOptions } from "@/lib/storyboard/launch-options";

export type { ActionResult } from "@/lib/storyboard/task-action";

export interface StartResult extends ActionResult {
  requiresConfirmation?: boolean;
  summary?: OrchestrationSummary;
  runId?: string;
}

/** `touchesRuns`: the action changes a run or auto mode, so the header chip and the Tasks rows (which poll more slowly than the board) refresh too, as after the Auto/Manual switch. */
async function post(url: string, body: unknown, touchesRuns = false, profile?: string): Promise<StartResult> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...profileHeaders(profile) }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => ({}))) as { error?: string; requiresConfirmation?: boolean; dispatchError?: string | null; summary?: OrchestrationSummary; runId?: string; reset?: { keptCheckouts: string[]; leftBehind: string[] } };
    const resetWarnings = json.reset ? [...(typeof body === "object" && body !== null && "discardWork" in body && body.discardWork ? json.reset.keptCheckouts.map((item) => `Kept ${item}`) : []), ...json.reset.leftBehind] : [];
    if (response.ok) return json.dispatchError ? { ok: false, error: json.dispatchError } : { ok: true, ...(resetWarnings.length ? { warning: `Task is back on To do. ${resetWarnings.join(". ")}.` } : {}), ...(json.summary ? { summary: json.summary } : {}), ...(json.runId ? { runId: json.runId } : {}) };
    return { ok: false, ...(json.requiresConfirmation ? { requiresConfirmation: true } : {}), error: json.error ?? `Request failed (${response.status})` };
  } catch {
    return { ok: false, error: "Couldn't reach DevHub. Refresh before retrying." };
  } finally {
    if (touchesRuns) {
      void mutate(ORCHESTRATIONS_KEY);
      void mutate(TASK_AGENT_RUNS_KEY);
    }
  }
}

/** A card with a note is addressed by its path; a task-only card by task and day (the route scaffolds the note). */
function noteTarget(card: BoardCard): Record<string, string> {
  return card.notePath ? { notePath: card.notePath } : { taskId: card.taskId, date: card.date };
}

/** The same set_status op the note's own status picker sends. */
export async function setCardStatus(card: BoardCard, status: string, profile?: string): Promise<ActionResult> {
  const result = await post("/api/storyboard/move", { taskId: card.taskId, status }, true, profile);
  if (!result.requiresConfirmation) return result;
  if (!window.confirm(`Stop the run and move to ${TASK_NOTE_STATUS_LABEL[status as TaskNoteStatus] ?? status}? The worktree and notes are kept.`)) return { ok: false, error: "Move cancelled. The task and its run are unchanged." };
  return post("/api/storyboard/move", { taskId: card.taskId, status, stopActive: true }, true, profile);
}

export function reopenCard(card: BoardCard, action: "reopen" | "reopen-feedback" | "follow-up", profile?: string): Promise<ActionResult> {
  return runTaskAction(card.taskId, action, () => post("/api/tasks/reopen", { id: card.taskId, date: card.date, addressFeedback: action === "reopen-feedback", followUp: action === "follow-up", reason: action === "reopen-feedback" ? "New PR feedback" : undefined }, true, profile), profile);
}

/** Position the card in its column: writes only this note's rank (fractional, so neighbours never change). */
export function setCardRank(card: BoardCard, rank: string): Promise<ActionResult> {
  return post("/api/tasks/note/sections", { ...noteTarget(card), op: "set_rank", rank });
}

/** Scaffold the task's note without changing anything on it (nothing is created until John asks). */
export function createCardNote(card: BoardCard): Promise<ActionResult> {
  return post("/api/tasks/note/sections", { taskId: card.taskId, date: card.date, op: "set_meta" });
}

/** Restart the task's agent: follow-up preferred, else a new run quoting the handoff. */
export function retryCard(card: BoardCard, profile?: string): Promise<ActionResult> {
  return runTaskAction(card.taskId, "retry", () => post("/api/tasks/agent-runs/resume", { taskId: card.taskId, date: new Date().toLocaleDateString("en-CA") }, true, profile), profile);
}

/** Auto mode at Needs you: retry the step (on a higher tier) or take one more fix round. */
export function retryAuto(taskId: string, profile?: string): Promise<ActionResult> {
  return runTaskAction(taskId, "auto-retry", () => post("/api/storyboard/orchestrate", { action: "retry", taskId, idempotencyKey: `retry-${crypto.randomUUID()}` }, true, profile), profile);
}

/** Card toggle: is this a UI change? null goes back to detection. */
export function setUiOverride(taskId: string, ui: boolean | null, profile?: string): Promise<ActionResult> {
  return post("/api/storyboard/orchestrate", { action: "ui", taskId, ui }, true, profile);
}

/** Approve a reviewed task's work and open its draft PR; the agent tags the PR on the task note. */
export function createPr(card: BoardCard, profile?: string): Promise<ActionResult> {
  return runTaskAction(card.taskId, "create-pr", () => post("/api/tasks/create-pr", { taskId: card.taskId, date: card.date }, true, profile), profile);
}

/** Run the independent review or Jev QA again on the same checkout. */
export function rerunStep(taskId: string, step: "qa" | "review", profile?: string): Promise<ActionResult> {
  return runTaskAction(taskId, "rerun-" + step, () => post("/api/storyboard/orchestrate", { action: "rerun", taskId, step, idempotencyKey: `rerun-${crypto.randomUUID()}` }, true, profile), profile);
}

/** Answer an open question with a question: the agent runs again with it. */
export function askBack(taskId: string, text: string, profile?: string): Promise<ActionResult> {
  return runTaskAction(taskId, "ask-back", () => post("/api/storyboard/orchestrate", { action: "ask-back", taskId, text, idempotencyKey: `ask-${crypto.randomUUID()}` }, true, profile), profile);
}

/** Back to To do: stops runs and forgets auto mode. `discardWork` also deletes the agent checkouts and local agent branches. */
export function resetTask(taskId: string, discardWork: boolean, profile?: string): Promise<ActionResult> {
  return runTaskAction(taskId, "reset", () => post("/api/storyboard/orchestrate", { action: "reset", taskId, discardWork }, true, profile), profile);
}

/** Mark an idle run abandoned so the card stops claiming it. */
export function clearRun(taskId: string, runId: string, profile?: string): Promise<ActionResult> {
  return post("/api/tasks/agent-runs", { taskId, runId, status: "abandoned" }, true, profile);
}

/** To do card: start on auto with the saved tiers (the route reads them when none are sent), same as Tasks' one-click Start on auto. */
export function startAuto(card: Pick<BoardCard, "taskId" | "date">, options?: AutoLaunchOptions & { cwd?: string; repoName?: string; tiers?: ModelTierSettings; pauseAfterPlan?: boolean }, profile?: string): Promise<StartResult> {
  return runTaskAction(card.taskId, "start-auto", () => post("/api/storyboard/orchestrate", { action: "start", taskId: card.taskId, taskDate: card.date, idempotencyKey: crypto.randomUUID().replaceAll("-", ""), ...options, pauseAfterPlan: options?.pauseAfterPlan ?? true }, true, profile), profile) as Promise<StartResult>;
}

/** The same PATCH /api/tasks the Today's-tasks list sends, so a menu action on a card is the same write as on a row. */
async function patchTask(body: Record<string, unknown>, profile?: string): Promise<ActionResult> {
  try {
    const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json", ...profileHeaders(profile) }, body: JSON.stringify(body) });
    if (response.ok) return { ok: true };
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: json.error ?? `Request failed (${response.status})` };
  } catch {
    return { ok: false, error: "Couldn't reach DevHub. Refresh before retrying." };
  } finally {
    void mutate((key) => typeof key === "string" && (key.startsWith("/api/tasks") || key.startsWith("/api/sidebar/counts")));
  }
}

export const completeTask = (taskId: string, date?: string, profile?: string) => runTaskAction(taskId, "complete", () => patchTask({ id: taskId, completion: true, ...(date ? { date } : {}) }, profile), profile);
export const undoCompleteTask = (taskId: string, date?: string, profile?: string) => runTaskAction(taskId, "undo-complete", () => patchTask({ id: taskId, completion: false, ...(date ? { date } : {}) }, profile), profile);
/** Pause auto and stop the task's live runs (worktree, note and history are kept). */
export function stopTaskWork(taskId: string, profile?: string): Promise<ActionResult> {
  return post("/api/storyboard/stop-work", { taskId }, true, profile);
}

export const abandonTask = (taskId: string, reason?: string, date?: string, profile?: string) => patchTask({ id: taskId, status: "abandoned", ...(reason ? { abandonReason: reason } : {}), ...(date ? { date } : {}) }, profile);
export const reactivateTask = (taskId: string, date?: string, profile?: string) => patchTask({ id: taskId, status: "active", ...(date ? { date } : {}) }, profile);
export const setTaskText = (taskId: string, text: string, date?: string, profile?: string) => patchTask({ id: taskId, text, ...(date ? { date } : {}) }, profile);
export const toggleTaskTimer = (taskId: string, running: boolean) => patchTask({ id: taskId, timer: running ? "stop" : "start" });

export async function deleteBoardTask(taskId: string): Promise<ActionResult> {
  try {
    const response = await fetch("/api/tasks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: taskId }) });
    if (response.ok || response.status === 404) return { ok: true };
    const problem = await response.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: problem.error ?? "Couldn't delete the task." };
  } catch {
    return { ok: false, error: "Couldn't reach DevHub. Refresh before retrying." };
  } finally {
    void mutate((key) => typeof key === "string" && (key.startsWith("/api/tasks") || key === "/api/sidebar/counts"));
  }
}

export function recoverCardFailure(card: BoardCard, action: "clear" | "restore" | "retry" | "resume", profile?: string, guidance?: string): Promise<ActionResult> {
  if (!card.failure) return Promise.resolve({ ok: false, error: "Refresh to load the failure first." });
  return runTaskAction(card.taskId, "failure-recovery", () => post("/api/tasks/failure", { taskId: card.taskId, key: card.failure!.key, action, ...(guidance ? { guidance } : {}) }, true, profile), profile);
}

export function decidePlan(card: BoardCard, decision: "approve" | "revise", profile?: string, guidance?: string): Promise<ActionResult> {
  if (!card.auto?.planRunId) return Promise.resolve({ ok: false, error: "Refresh to load the latest plan before continuing." });
  return runTaskAction(card.taskId, "plan-decision", () => post("/api/storyboard/orchestrate", {
    action: "plan-decision", taskId: card.taskId, planRunId: card.auto!.planRunId, decision, guidance,
    idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
  }, true, profile), profile);
}
