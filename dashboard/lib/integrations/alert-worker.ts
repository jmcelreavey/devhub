import { readAgentRun } from "@/lib/agent-runs/store";
import { listAutoPrReviewRecords } from "@/lib/github/auto-pr-review-state";
import { readGithubPrsListCache } from "@/lib/github/prs";
import { loadGithubPrsList } from "@/lib/github/prs-list";
import { readNotesBoard } from "@/lib/storyboard/notes-board";
import { prAlertEvents } from "./pr-alert-events";
import { isPrAlert } from "./pr-announcement";
import { getTaskProfileOverview } from "@/lib/tasks/profiles";
import { currentTaskNode, loadTaskIndex } from "@/lib/tasks/task-index";
import { listWorkflows } from "@/lib/workflows/store";
import { classifyAlert, processAlerts, readAlerts, type AlertEvent } from "./alert-store";

export function alertProfile() { return getTaskProfileOverview().active ?? "default"; }
export async function runAlertTick() {
  const profile = alertProfile();
  const destinations = readAlerts().destinations.filter((d) => d.enabled && d.workProfile === profile);
  if (!destinations.length) return;
  const index = loadTaskIndex();
  const workflows = listWorkflows();
  const events: AlertEvent[] = workflows.flatMap((workflow) => {
    const node = currentTaskNode(index, workflow.taskId);
    if (!node || node.task.id !== workflow.taskId) return [];
    return workflow.events.flatMap((event) => {
      const kind = classifyAlert(event.summary);
      return kind ? [{ id: event.id, at: event.at, taskId: workflow.taskId, kind }] : [];
    });
  });
  let deferPrAlerts = false;
  if (destinations.some((d) => d.events.some(isPrAlert))) {
    try {
      const board = readNotesBoard();
      const cache = readGithubPrsListCache() ?? await loadGithubPrsList();
      if (board.errors.length || !cache.configured || cache.stale) throw new Error("PR announcement sources are unavailable");
      events.push(...prAlertEvents({ profile, cards: board.cards, workflows, prs: [...cache.authored, ...cache.reviews], autoReviews: listAutoPrReviewRecords(), readRun: readAgentRun, now: Date.now() }));
    } catch {
      deferPrAlerts = true;
      console.error("[workflow-alerts] PR announcements paused until their sources are available.");
    }
  }
  await processAlerts(events, profile, { deferPrAlerts });
}
const runtime = globalThis as typeof globalThis & { __devhubAlertWorker?: boolean };
export function startAlertWorker() {
  if (runtime.__devhubAlertWorker) return;
  runtime.__devhubAlertWorker = true;
  const run = async () => {
    try { await runAlertTick(); }
    catch { console.error("[workflow-alerts] Delivery worker paused this tick. Check alert settings and local state."); }
    setTimeout(() => void run(), 5000).unref();
  };
  setTimeout(() => void run(), 5000).unref();
}
