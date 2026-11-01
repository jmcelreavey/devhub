import fs from "node:fs";
import path from "node:path";
import { findTask, invalidateTaskCache, readItems } from "../../domains/tasks/store";
import { isTaskOpen, isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import { withTaskDirectory } from "../../domains/tasks/profile-context";
import { readTaskNoteMarkdown } from "../../domains/tasks/implement-ready-gather";
import { todayISO } from "../../../../../packages/shared/tasks/dates";
import { isVisibleOn } from "../../../../../packages/shared/tasks/view";
import { getNotesDir } from "../content/dirs";
import { readNotesBoard } from "../storyboard/notes-board";
import { readFailureAcknowledgement } from "../storyboard/failure-acknowledgements";
import { listWorkflows } from "../workflows/store";
import { assertSafePath } from "./filesystem";
import { servicePlanFingerprint } from "./runtime-service-workflow";
import { serviceLinkedRuns, serviceRunUsage } from "./runtime-service-run-usage";

function entries(root: string, relative: string): string[] {
  const dir = path.join(root, relative);
  assertSafePath(root, dir);
  try { return fs.readdirSync(dir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

/** The board's existing readers include files outside the vault storage's symlink checks. */
function assertBoardPaths(directory: string): void {
  for (const name of entries(directory, "items")) {
    if (name.endsWith(".json") && !name.endsWith(".local.json")) assertSafePath(directory, path.join(directory, "items", name));
  }
  const configuredNotes = getNotesDir();
  const notes = fs.existsSync(configuredNotes) ? fs.realpathSync(configuredNotes) : path.resolve(configuredNotes);
  for (const relative of [".config/storyboard/orchestrations", ".config/storyboard/failure-acknowledgements", ".config/task-workflows", ".config/task-agent-runs"]) {
    for (const name of entries(notes, relative)) {
      if (name.endsWith(".json")) assertSafePath(notes, path.join(notes, relative, name));
    }
  }
  assertSafePath(notes, path.join(notes, ".config/task-note-agent-updates.json"));
  for (const id of entries(notes, ".config/qa/runs")) {
    if (/^[a-f0-9-]{36}$/.test(id)) assertSafePath(notes, path.join(notes, ".config/qa/runs", id, "receipt.json"));
  }
}

export function serviceBoardSnapshot(root: string, directory: string, current: () => boolean, profile: string, runUsageCurrent?: () => boolean) {
  if (!current()) throw new Error("Service is not authorised");
  assertBoardPaths(directory);
  const result = withTaskDirectory(root, directory, () => {
    const configuredNotes = getNotesDir();
    const notes = fs.existsSync(configuredNotes) ? fs.realpathSync(configuredNotes) : path.resolve(configuredNotes);
    const tasks = readItems(directory);
    let uncertainRunState = !runUsageCurrent || !runUsageCurrent();
    const usageEnabled = !uncertainRunState;
    const tasksByRun = new Map<string, typeof tasks[number] | null>();
    const usageByRun = new Map<string, ReturnType<typeof serviceRunUsage>>();
    if (!uncertainRunState) for (const task of tasks) for (const runId of serviceLinkedRuns(task, notes)) {
      tasksByRun.set(runId, tasksByRun.has(runId) ? null : task);
    }
    const board = readNotesBoard({ doneWindowDays: null, readOnly: true, ...(uncertainRunState ? {} : { usageFor: (runId: string) => {
      const task = tasksByRun.get(runId);
      if (!usageByRun.has(runId)) usageByRun.set(runId, task && runUsageCurrent ? serviceRunUsage(task, directory, profile, runId, runUsageCurrent) : null);
      const usage = usageByRun.get(runId);
      if (!usage && (!task || (isTaskOpen(task) && !isTaskOwnershipBlocked(task)))) uncertainRunState = true;
      return usage ?? undefined;
    } }) });
    const byId = new Map(board.cards.map((card) => [card.taskId, card]));
    const errors = [...board.errors];
    const items = listWorkflows(notes, (name, error) => {
      errors.push(`task-workflows/${name}: ${error instanceof Error ? error.message : String(error)}`);
    }).flatMap((workflow) => {
      const card = byId.get(workflow.taskId);
      return card?.task ? [{ task: card.task, workflow }] : [];
    });
    if (uncertainRunState && board.cards.some((card) => card.failure && readFailureAcknowledgement(card.taskId, notes))) {
      errors.push("A failure acknowledgement could not be verified in this read-only board snapshot.");
    }
    const plans = Object.fromEntries(board.cards.flatMap((card) => {
      const runId = card.auto?.planRunId;
      if (!runId) return [];
      if (card.notePath) assertSafePath(notes, path.resolve(notes, card.notePath + ".json"));
      const markdown = card.notePath ? readTaskNoteMarkdown(card.notePath) ?? "" : "";
      const plan = markdown.match(/^##\s+Plan\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1]?.trim() ?? "";
      const summary = card.summary?.filter(Boolean).join("\n") || plan.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5).join("\n") || "Open the plan in DevHub to review the details.";
      return [[card.taskId, { runId, fingerprint: servicePlanFingerprint(runId, markdown), summary }]];
    }));
    const today = todayISO();
    if (usageEnabled) {
      if (!runUsageCurrent?.()) throw new Error("Service authorisation or active task profile changed");
      invalidateTaskCache(directory);
      for (const [runId, usage] of usageByRun) {
        if (!usage) continue;
        const task = tasksByRun.get(runId);
        if (task) assertSafePath(directory, path.join(directory, "items", task.id + ".json"));
        const latest = task && findTask(directory, task.id);
        if (!task || !latest || latest.createdAt !== task.createdAt || isTaskOwnershipBlocked(latest)) throw new Error("The task changed");
      }
    }
    return { cards: board.cards, items, todayTaskIds: tasks.filter((task) => isVisibleOn(task, today, today)).map((task) => task.id), errors, plans, ...(runUsageCurrent ? { uncertainRunState } : {}) };
  });
  if (!current()) throw new Error("Service is not authorised");
  return result;
}
