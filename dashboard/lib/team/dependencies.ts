import { createTask, findTask, writeItem } from "@shared/tasks/store.ts";
import type { Task } from "@shared/tasks/types.ts";
import { buildTaskNoteMarkdown } from "@shared/task-note/index.ts";
import { applyTaskNoteOp, blockPlainText, type NoteBlock } from "@shared/task-note/sections.ts";
import { textToBlocks } from "@shared/markdown-convert/index.ts";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { getStorage } from "@/lib/storage-server";
import { resolveTaskNotePath } from "@/lib/tasks/task-notes";
import { readAgentRun, cancelAgentRun, reconcileAgentRun } from "@/lib/agent-runs/store";
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { cancelManagedRun, reconcileManagedRun } from "@/lib/paseo/lifecycle";
import { withSlackProfile } from "@/lib/integrations/slack/answers";
import { answerSlackTask, slackTaskQuestions } from "@/lib/integrations/slack/needs-you-source";
import { listRepos } from "@/lib/repos";
import { jiraConnection } from "@/lib/integrations/jira";
import { prepareJiraWrite, executeJiraWrite } from "@/lib/integrations/jira-write";
import type { WriteInput } from "@/lib/integrations/write-types";
import { loadTeamTaskContext, type TeamTaskContext } from "./context";
import { fetchHandoffWorktree, gitOrigin, inspectHandoffGit, pushHandoffBranch } from "./git";
import type { TeamBundle } from "./store";

function writeNote(task: Task, profile: string, note: string): void {
  withSlackProfile(profile, () => {
    const storage = getStorage();
    const notePath = resolveTaskNotePath(task, task.startDate);
    const existing = storage.read(notePath);
    const blocks = existing ? existing.content : textToBlocks(buildTaskNoteMarkdown({ id: task.id, date: task.startDate, text: task.text, jiraKey: task.jiraKey, notePath }));
    if (!Array.isArray(blocks)) throw new Error("The task note is not a BlockNote note.");
    const start = blocks.findIndex((block: NoteBlock) => block.type === "heading" && blockPlainText(block).trim() === "Handoff");
    const next = start < 0 ? -1 : blocks.findIndex((block: NoteBlock, index: number) => index > start && block.type === "heading" && Number(block.props?.level ?? 2) <= 2);
    const section = textToBlocks("## Handoff\n\n" + note);
    let imported = start < 0 ? [...blocks, ...section] : [...blocks.slice(0, start), ...section, ...(next < 0 ? [] : blocks.slice(next))];
    if (task.stage === "draft" && !task.handoff) {
      const question = note.match(/(?:^|\n\n)Question: ([\s\S]*?)(?=\n\nBranch:|$)/)?.[1]?.trim();
      if (question) imported = applyTaskNoteOp(imported, { op: "add_question", text: question }).blocks;
    }
    storage.write(notePath, imported);
  });
}
async function cancelRuns(context: TeamTaskContext): Promise<void> {
  for (const entry of context.runs) {
    const run = readAgentRun(entry.runId);
    if (!run || !isActiveAgentRunState(run.status.state)) continue;
    if (run.spec.runtime === "generation" || run.spec.bin === "interactive") throw new Error("Stop this agent in its own window before handing off.");
    if (run.spec.runtime === "paseo" || run.spec.runtime === "aionui") await cancelManagedRun(run);
    else cancelAgentRun(run);
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = readAgentRun(entry.runId);
      if (!current) break;
      const reconciled = current.spec.runtime === "paseo" || current.spec.runtime === "aionui" ? await reconcileManagedRun(current) : reconcileAgentRun(current);
      if (!isActiveAgentRunState(reconciled.status.state)) break;
      if (attempt === 49) throw new Error("The agent is still stopping. Try handing off once it has stopped.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
export const teamDependencies = {
  context: loadTeamTaskContext,
  questions: slackTaskQuestions,
  answer: answerSlackTask,
  getTask: (taskId: string, profile: string) => withSlackProfile(profile, () => findTask(getActiveTasksDir(), taskId)),
  setHandoff: (taskId: string, profile: string, handoff: Task["handoff"]) => withSlackProfile(profile, () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task) throw new Error("That task could not be found.");
    writeItem(getActiveTasksDir(), { ...task, handoff });
  }),
  cancelRuns, inspect: inspectHandoffGit, push: pushHandoffBranch, writeNote,
  repos: async () => {
    const results = await Promise.allSettled((await listRepos()).map(async (repo) => ({ ...repo, origin: await gitOrigin(repo.path) })));
    return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  },
  fetchWorktree: fetchHandoffWorktree,
  createPickup: (bundle: TeamBundle, profile: string, checkout: { cwd: string; branch: string }) => withSlackProfile(profile, () => {
    const existing = findTask(getActiveTasksDir(), bundle.handoffId);
    if (existing) return existing;
    return createTask(getActiveTasksDir(), { id: bundle.handoffId, text: bundle.title, links: [{ kind: "repo", id: bundle.repo.replace(/^[^/]+\//, ""), label: bundle.repo }], stage: "draft", teamPickup: { handoffId: bundle.handoffId, ...checkout, status: "pending" } });
  }),
  holdPickup: (taskId: string, profile: string, handoffId: string, checkout: { cwd: string; branch: string }) => withSlackProfile(profile, () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task) throw new Error("The pickup task is missing.");
    writeItem(getActiveTasksDir(), { ...task, teamPickup: { handoffId, ...checkout, status: "pending" } });
  }),
  finishPickup: (taskId: string, profile: string, bundle: Pick<TeamBundle, "handoffId" | "jiraKey">, checkout: { cwd: string; branch: string }) => withSlackProfile(profile, () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task) throw new Error("The picked-up task could not be found.");
    writeItem(getActiveTasksDir(), { ...task, jiraKey: bundle.jiraKey, stage: undefined, teamPickup: { handoffId: bundle.handoffId, ...checkout } });
  }),
  retirePickup: (taskId: string, profile: string) => withSlackProfile(profile, () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task) throw new Error("The pickup task is missing.");
    const now = new Date();
    writeItem(getActiveTasksDir(), { ...task, abandonedAt: now.toISOString(), endDate: now.toISOString().slice(0, 10), abandonReason: "Handoff was declined/expired" });
  }),
  jiraConnected: () => { try { jiraConnection("default"); return true; } catch { return false; } },
  assignJira: async (key: string, handoffId: string) => {
    const input: WriteInput = { action: "issue.assign-self", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: key } };
    const context = { signal: AbortSignal.timeout(30_000), approvalId: "team-pickup-" + handoffId };
    const prepared = await prepareJiraWrite(input, context);
    await executeJiraWrite(input, prepared, context);
  },
};
export type TeamDependencies = typeof teamDependencies;
