import type { Task } from "@/lib/tasks/types";
import type { TaskWorkflow } from "./types";

export const WORKFLOW_INBOX_KEY = "/api/tasks/workflow";
/** Where the inbox lives: a drawer on the Storyboard. */
export const WORKFLOW_INBOX_HREF = "/storyboard?inbox=1";

export interface WorkflowInboxItem {
  task: Task & { date?: string };
  workflow: TaskWorkflow;
}
export interface WorkflowInboxResponse {
  items: WorkflowInboxItem[];
}

export const isUnread = (workflow: TaskWorkflow): boolean => workflow.seenRevision < workflow.revision;

/** Newest activity time, for ordering. */
function lastActivity(workflow: TaskWorkflow): number {
  const at = workflow.events.at(-1)?.at;
  return at ? Date.parse(at) || 0 : 0;
}

/** Unread first, then most recent activity. */
export function sortInbox(items: readonly WorkflowInboxItem[]): WorkflowInboxItem[] {
  return [...items].sort((a, b) => Number(isUnread(b.workflow)) - Number(isUnread(a.workflow)) || lastActivity(b.workflow) - lastActivity(a.workflow));
}

const READ_EVENTS = new Set(["Updates read", "Marked unread"]);

/** "Review · waiting for you — Review accepted": stage, status, latest event. */
export function inboxLine(workflow: TaskWorkflow): string {
  const stage = workflow.stage === "draft-pr" ? "Draft PR" : workflow.stage[0].toUpperCase() + workflow.stage.slice(1);
  const status = workflow.status === "waiting-user" ? "waiting for you" : workflow.status.replaceAll("-", " ");
  // Read-state bookkeeping isn't news.
  const latest = workflow.events.findLast((event) => !READ_EVENTS.has(event.summary))?.summary;
  return `${stage} · ${status}${latest ? ` — ${latest}` : ""}`;
}

/** Mark one workflow read or unread. Returns false when the server refused (e.g. it changed meanwhile). */
export async function setInboxRead(item: WorkflowInboxItem, read: boolean): Promise<boolean> {
  const response = await fetch(WORKFLOW_INBOX_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: item.task.id, revision: item.workflow.revision, action: read ? "seen" : "unseen" }),
  });
  return response.ok;
}
