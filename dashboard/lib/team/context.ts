import { createHash } from "node:crypto";
import { findTask } from "@shared/tasks/store.ts";
import type { Task } from "@shared/tasks/types.ts";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { readTaskNoteMarkdown, resolveTaskNotePath } from "@/lib/tasks/implement-ready-gather";
import { getTaskAgentHandoff, listTaskAgentRuns, type TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { slackTaskQuestions } from "@/lib/integrations/slack/needs-you-source";
import { withSlackProfile } from "@/lib/integrations/slack/answers";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";
import { readOrchestration } from "@/lib/storyboard/orchestration-store";

export interface TeamTaskContext {
  task: Task;
  profile: string;
  question: { id: string; text: string };
  sections: string[];
  note: string;
  runs: TaskAgentRunRecord[];
  cwd?: string;
  branch?: string;
  prUrl?: string;
}
export function teamContextSections(sections: readonly string[]): string[] {
  return sections.map((section, index) => index === 0 ? "*Task*\n" + section
    : section.replace(/^(Ticket|Summary|What changed|State|Next steps|Plan|Last run|Branch|PR|Question): ?/gm, "*$1*\n"));
}
export function teamHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function loadTeamTaskContext(taskId: string, profile: string): Promise<TeamTaskContext> {
  return withSlackProfile(profile, async () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task || task.done || task.abandonedAt) throw new Error("That task is no longer open.");
    if (isTaskOwnershipBlocked(task)) throw new Error("This task's ownership is pending or handed off and is read-only.");
    const view = updateTaskNoteSections({ taskId }, { op: "read" }).view;
    const markdown = readTaskNoteMarkdown(resolveTaskNotePath(task, task.startDate)) ?? "";
    const runs = listTaskAgentRuns(taskId);
    const latest = runs[0];
    const question = slackTaskQuestions(profile, taskId).questions[0] ?? { id: "", text: "" };
    const repo = task.links?.find((link) => link.kind === "repo");
    const local = repo ? (await resolveLocalGithubRepos()).find((entry) => [entry.fullName, entry.repo.name].includes(repo.id)) : undefined;
    const cwd = task.teamPickup?.cwd ?? latest?.cwd ?? readOrchestration(taskId)?.repo?.cwd ?? local?.repo.path;
    const plan = markdown.match(/^## (?:Plan|Acceptance)[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.slice(0, 600) ?? "";
    const status = view.statusUpdate;
    const sections = [task.text, task.jiraKey ? "Ticket: " + task.jiraKey + " " + (task.links?.find((link) => link.kind === "jira")?.href ?? "") : "",
      view.summary.length ? "Summary: " + view.summary.join("\n") : "",
      status ? ["Summary: " + status.summary, "What changed: " + status.whatChanged, "State: " + status.currentState, "Next steps: " + status.nextStep].join("\n") : "",
      plan ? "Plan: " + plan : "", latest ? "Last run: " + latest.status + " " + (getTaskAgentHandoff(taskId).handoff.slice(0, 800) || "") : "",
      latest?.branch ? "Branch: " + latest.branch : "", latest?.prUrl ? "PR: " + latest.prUrl : "", question.text ? "Question: " + question.text : "",
    ].filter(Boolean);
    return { task, profile, question, sections: teamContextSections(sections), note: sections.join("\n\n"), runs, cwd, branch: task.teamPickup?.branch ?? latest?.branch, prUrl: latest?.prUrl };
  });
}
