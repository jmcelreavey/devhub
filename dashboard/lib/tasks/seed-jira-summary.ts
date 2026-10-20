import { getTicketWithDescription } from "@/lib/jira/client";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import type { Task } from "@/lib/tasks/types";

const MAX_CHARS = 700;

/** The ticket's own words, trimmed at a sentence or word boundary: a note summary is two or three lines, not the whole ticket. */
export function summaryFromJiraDescription(description: string | null | undefined): string | null {
  const text = (description ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  const end = sentence > MAX_CHARS * 0.5 ? sentence + 1 : cut.lastIndexOf(" ");
  return `${cut.slice(0, end > 0 ? end : MAX_CHARS).trim()}…`;
}

/**
 * A task made from a Jira ticket starts with the ticket's description as its note summary, so the card and panel
 * never read "No summary yet". Best effort and never overwrites a summary that is already there.
 */
export async function seedSummaryFromJira(task: Task, date: string): Promise<void> {
  const key = task.jiraKey;
  if (!key) return;
  try {
    const ticket = await getTicketWithDescription(key, AbortSignal.timeout(8000));
    const summary = summaryFromJiraDescription(ticket?.description);
    if (!summary) return;
    try {
      if (updateTaskNoteSections({ taskId: task.id, date }, { op: "read" }).view?.summary.length) return;
    } catch {
      // No note yet: the write below creates it.
    }
    updateTaskNoteSections({ taskId: task.id, date }, { op: "set_summary", text: summary });
  } catch (error) {
    console.warn("[tasks] couldn't seed the summary from Jira", error instanceof Error ? error.message : error);
  }
}
