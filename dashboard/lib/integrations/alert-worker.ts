import { getTaskProfileOverview } from "@/lib/tasks/profiles";
import { currentTaskNode, loadTaskIndex } from "@/lib/tasks/task-index";
import { listWorkflows } from "@/lib/workflows/store";
import { classifyAlert, processAlerts, readAlerts, type AlertEvent } from "./alert-store";

export function alertProfile() { return getTaskProfileOverview().active ?? "default"; }
async function tick() {
  const profile = alertProfile();
  if (!readAlerts().destinations.some((d) => d.enabled && d.workProfile === profile)) return;
  const index = loadTaskIndex();
  const events: AlertEvent[] = listWorkflows().flatMap((workflow) => {
    const node = currentTaskNode(index, workflow.taskId);
    if (!node || node.task.id !== workflow.taskId) return [];
    return workflow.events.flatMap((event) => {
      const kind = classifyAlert(event.summary);
      return kind ? [{ id: event.id, at: event.at, taskId: workflow.taskId, kind }] : [];
    });
  });
  await processAlerts(events, profile);
}
const runtime = globalThis as typeof globalThis & { __devhubAlertWorker?: boolean };
export function startAlertWorker() {
  if (runtime.__devhubAlertWorker) return;
  runtime.__devhubAlertWorker = true;
  const run = async () => {
    try { await tick(); }
    catch { console.error("[workflow-alerts] Delivery worker paused this tick. Check alert settings and local state."); }
    setTimeout(() => void run(), 5000).unref();
  };
  setTimeout(() => void run(), 5000).unref();
}
