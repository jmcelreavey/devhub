/**
 * Resume a DevHub task's agent work: prefer follow-up on the latest linked run
 * (POST /api/agent/runs/<id> semantics), else dispatch a new run quoting handoff.
 */
import { AgentDispatchError,dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { readRunEvents } from "@/lib/agent-runs/run-files";
import { readAgentRun,toAgentRunSummary,type AgentRun,type AgentRunSummary } from "@/lib/agent-runs/store";
import { aionCatalog,assistantForProvider } from "@/lib/aionui/catalog";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";
import { selectTaskImplementationRepo } from "@/lib/tasks/implement-repo";
import { reconcileTaskAgentRunSidecar } from "@/lib/tasks/reconcile-task-agent-sidecar";
import { getTasks } from "@/lib/tasks/storage";
import {
buildTaskAgentResumePrompt,
canResumeTaskAgentRun,
formatAgentActivityTrailForResume,
willResumeFollowUpSession,
} from "@/lib/tasks/task-agent-resume";
import {
getTaskAgentHandoff,
isActiveTaskAgentRunStatus,
type TaskAgentRunRecord,
} from "@/lib/tasks/task-agent-runs";
import { handleTaskPrAttention } from "@/lib/tasks/task-pr-watch";
import type { Task } from "@/lib/tasks/types";

export class TaskAgentResumeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TaskAgentResumeError";
  }
}

export interface ResumeTaskAgentInput {
  taskId: string;
  date: string;
  origin: string;
  /** UI or agent_dispatch provider id. */
  provider?: string;
  model?: string;
  /** Wins over plan/prior-run cwd when set. */
  cwd?: string;
  repoName?: string;
}

export interface ResumeTaskAgentResult {
  mode: "followup" | "new";
  run: AgentRunSummary;
  priorRunId: string | null;
  handoffChars: number;
}

async function pickInstalledProvider(preferred?: string): Promise<string> {
  const { assistants, session } = await aionCatalog();
  const assistant = assistantForProvider(assistants, preferred && preferred !== "default" ? preferred : session.defaultAssistantId);
  if (!assistant?.enabled || assistant.agent_status !== "online") throw new TaskAgentResumeError("The selected agent needs setup in Agents.", 400);
  return assistant.id;
}

/** Where a fresh run works: explicit cwd, else the prior run's, else the task's linked repo. */
async function resolveImplementCwd(
  explicit: string | undefined,
  priorAgentCwd: string | undefined,
  task: Task,
): Promise<{ cwd: string; repoName?: string }> {
  const direct = explicit?.trim() || priorAgentCwd?.trim();
  if (direct) return { cwd: direct };
  const repoId = (task.links ?? []).find((l) => l.kind === "repo")?.id;
  if (!repoId) {
    throw new TaskAgentResumeError(
      "Cannot start a new agent run: no cwd from the prior run and no linked repo on the task.",
      400,
    );
  }
  const localRepos = await resolveLocalGithubRepos().catch(() => []);
  const localRepo = selectTaskImplementationRepo(repoId.toLowerCase(), localRepos);
  if (!localRepo?.repo.path) {
    throw new TaskAgentResumeError(`Linked repo ${repoId} is not available as a local checkout.`, 400);
  }
  return { cwd: localRepo.repo.path, repoName: repoId };
}

async function linkRun(taskId: string, run: AgentRun, prior: TaskAgentRunRecord | null): Promise<void> {
  // The agent was sent back for the PR finding — don't raise it again.
  if (prior?.attention) await handleTaskPrAttention(taskId, prior.runId);
  // Dispatch links the task before submission so completion cannot race the sidecar.
  void run;
}

/**
 * Headless resume for MCP / API callers (no human at a terminal prompt). The UI
 * resumes interactively, but both use the same rules: a run that is still
 * active is refused, and the prior CLI session is continued exactly when
 * `willResumeFollowUpSession` says so — otherwise a new run quotes the handoff.
 */
export async function resumeTaskAgent(input: ResumeTaskAgentInput): Promise<ResumeTaskAgentResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new TaskAgentResumeError("date must be YYYY-MM-DD", 400);
  }
  const task = getTasks(input.date).find((t) => t.id === input.taskId);
  if (!task) throw new TaskAgentResumeError(`Task ${input.taskId} not found on ${input.date}`, 404);

  await reconcileTaskAgentRunSidecar(input.taskId);
  const view = getTaskAgentHandoff(input.taskId);
  const latest = view.latestRun;
  if (latest && isActiveTaskAgentRunStatus(latest.status)) {
    throw new TaskAgentResumeError(
      `Run ${latest.runId} is still ${latest.status} — wait for it or cancel it first.`,
      409,
    );
  }
  const prior = latest ? readAgentRun(latest.runId) : null;
  const priorSessionId = prior?.status.sessionId ?? latest?.sessionId ?? null;
  const provider = await pickInstalledProvider(input.provider ?? latest?.provider ?? prior?.spec.provider);
  const result = (mode: ResumeTaskAgentResult["mode"], run: AgentRun): ResumeTaskAgentResult => ({
    mode,
    run: toAgentRunSummary(run),
    priorRunId: latest?.runId ?? null,
    handoffChars: view.handoff.length,
  });

  const followUp =
    prior !== null &&
    canResumeTaskAgentRun(latest?.status, priorSessionId) &&
    willResumeFollowUpSession({
      priorDispatchProvider: prior.spec.provider,
      selectedUiProvider: provider,
      priorSessionId,
      priorSupportsResume: prior.spec.runtime === "aionui",
    });

  const cwd = followUp ? { cwd: prior.spec.cwd } : await resolveImplementCwd(input.cwd, prior?.spec.cwd, task);
  const activityTrail = prior
    ? formatAgentActivityTrailForResume(readRunEvents(prior.dir, 0, 500).events)
    : "";
  const prompt = buildTaskAgentResumePrompt({
    origin: input.origin,
    taskId: input.taskId,
    date: input.date,
    handoff: view.handoff,
    priorRunId: latest?.runId,
    cwd: cwd.cwd,
    repoName: input.repoName ?? cwd.repoName,
    jiraKey: task.jiraKey,
    activityTrail: activityTrail || undefined,
    ...(latest?.attention ? { attention: { ...latest.attention, prUrl: latest.prUrl } } : {}),
  });
  const common = {
    provider,
    prompt,
    cwd: cwd.cwd,
    title: `Resume ${input.taskId.slice(0, 8)}`,
    depth: 0,
    worktree: false,
    parentRunId: latest?.runId,
    activity: { source: "interactive" as const, action: "resume", taskId: input.taskId, taskDate: input.date },
  };

  if (followUp) {
    try {
      const next = await dispatchAgentRun({
        ...common,
        model: input.model ?? prior.spec.model,
        resumeSessionId: priorSessionId ?? undefined,
        inherit: { baseSha: prior.spec.baseSha, worktree: prior.spec.worktree },
      });
      await linkRun(input.taskId, next, latest);
      return result("followup", next);
    } catch (err) {
      if (err instanceof AgentDispatchError) throw new TaskAgentResumeError(err.message, err.status);
      throw err;
    }
  }

  try {
    const next = await dispatchAgentRun({ ...common, model: input.model });
    await linkRun(input.taskId, next, latest);
    return result("new", next);
  } catch (err) {
    if (err instanceof AgentDispatchError) throw new TaskAgentResumeError(err.message, err.status);
    throw err;
  }
}
