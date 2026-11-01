/**
 * A task's plan as one portable markdown file: the task, its note (plan,
 * acceptance, open questions, context), the handoff and the agent runs with
 * their PRs. Readable by a teammate or an agent that can't reach this
 * machine's dashboard or read BlockNote JSON.
 */
import type { Task } from "../../../../../packages/shared/tasks/types";
import { readSourceContextIfPresent } from "./source-context";
import { readTaskNoteMarkdown, resolveTaskNotePath } from "./implement-ready-gather";
import { getTaskAgentRuns, listTaskAgentRuns } from "./task-agent-runs";

function taskState(task: Task): string {
  if (task.done) return "done";
  if (task.abandonedAt) return `abandoned${task.abandonReason ? ` (${task.abandonReason})` : ""}`;
  return task.stage === "draft" ? "draft" : "ready";
}

export function buildPlanMarkdown(task: Task, date: string): string {
  const notePath = resolveTaskNotePath(task, date);
  const note = readTaskNoteMarkdown(notePath)?.trim();
  const { handoff } = getTaskAgentRuns(task.id);
  const runs = listTaskAgentRuns(task.id);

  const lines = [
    `# Plan: ${task.text}`,
    "",
    `- Task: \`${task.id}\` on ${date} — ${taskState(task)}`,
  ];
  if (task.jiraKey) lines.push(`- Jira: ${task.jiraKey}`);
  if (task.due) lines.push(`- Due: ${task.due}`);
  for (const link of task.links ?? []) {
    lines.push(`- Link (${link.kind}): ${link.href ? `[${link.label ?? link.id}](${link.href})` : (link.label ?? link.id)}`);
  }

  lines.push("", "## Task note", "", note || "_No task note yet._");

  const context = readSourceContextIfPresent(task.id);
  if (context?.snapshot) {
    const { source, revision, refreshedAt } = context.snapshot;
    lines.push("", "## Jira source snapshot", "", `Revision ${revision} · fetched ${refreshedAt}`,
      context.stale ? "**Source or brief changed: review context before using this handoff.**" : "Reviewed against the current brief.",
      "", `${source.key}: ${source.summary}`, "", source.description);
    if (source.parent) lines.push("", `Parent ${source.parent.key}: ${source.parent.summary}`, source.parent.description);
    for (const link of source.links) lines.push(`- ${link.relationship}: ${link.key} — ${link.summary}`);
    for (const comment of source.comments) lines.push("", `Comment ${comment.id} · ${comment.author} · ${comment.updated}`, comment.text);
  }
  lines.push("", "## Handoff", "", handoff.trim() || "_No handoff yet._");

  lines.push("", "## Agent runs", "");
  if (runs.length === 0) lines.push("_None yet._");
  for (const run of runs) {
    const parts = [`\`${run.runId}\` ${run.status}`];
    if (run.provider) parts.push(run.provider);
    if (run.branch) parts.push(`branch \`${run.branch}\``);
    if (run.prUrl) parts.push(`PR ${run.prUrl}${run.prState ? ` (${run.prState})` : ""}`);
    lines.push(`- ${parts.join(" · ")} — started ${run.startedAt}`);
    if (run.attention) lines.push(`  - Needs attention: ${run.attention.summary}`);
  }
  return `${lines.join("\n")}\n`;
}
