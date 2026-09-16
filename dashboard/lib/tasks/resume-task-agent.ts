/**
 * Resume a DevHub task's agent work: prefer follow-up on the latest linked run
 * (POST /api/agent/runs/<id> semantics), else dispatch a new run quoting handoff.
 */
import { AgentDispatchError, dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { getAgentProvider, listAgentProviders } from "@/lib/agent-runs/providers";
import { readAgentRun, toAgentRunSummary, type AgentRun, type AgentRunSummary } from "@/lib/agent-runs/store";
import { getTasks } from "@/lib/tasks/storage";
import type { Task } from "@/lib/tasks/types";
import {
  getTaskAgentHandoff,
  isActiveTaskAgentRunStatus,
  upsertTaskAgentRun,
  type TaskAgentRunRecord,
} from "@/lib/tasks/task-agent-runs";
import { handleTaskPrAttention } from "@/lib/tasks/task-pr-watch";
import { reconcileTaskAgentRunSidecar } from "@/lib/tasks/reconcile-task-agent-sidecar";
import {
  buildTaskAgentResumePrompt,
  canResumeTaskAgentRun,
  mapUiProviderToAgentDispatch,
  willResumeFollowUpSession,
} from "@/lib/tasks/task-agent-resume";
import { selectTaskImplementationRepo } from "@/lib/tasks/implement-repo";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";

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

function pickInstalledProvider(preferred?: string): string {
  // "default" / "openchamber" map to null → fall back to an installed CLI.
  const mapped = preferred ? (mapUiProviderToAgentDispatch(preferred) ?? "") : "";
  const { providers } = listAgentProviders();
  const installed = providers.filter((p) => p.binPath);
  if (mapped) {
    const hit = installed.find((p) => p.spec.id === mapped);
    if (hit) return hit.spec.id;
    throw new TaskAgentResumeError(
      `Provider "${mapped}" is not installed. Install it or pass another provider.`,
      400,
    );
  }
  const fallback = installed.find((p) => p.spec.id === "claude") ?? installed[0];
  if (!fallback) {
    throw new TaskAgentResumeError("No agent CLI is installed for dispatch.", 400);
  }
  return fallback.spec.id;
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
  await upsertTaskAgentRun({
    taskId,
    runId: run.spec.id,
    status: "queued",
    provider: run.spec.provider,
    sessionId: run.status.sessionId ?? null,
  });
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
  const provider = pickInstalledProvider(input.provider ?? latest?.provider ?? prior?.spec.provider);
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
      priorSupportsResume: getAgentProvider(prior.spec.provider)?.spec.supportsResume === true,
    });

  const cwd = followUp ? { cwd: prior.spec.cwd } : await resolveImplementCwd(input.cwd, prior?.spec.cwd, task);
  const prompt = buildTaskAgentResumePrompt({
    origin: input.origin,
    taskId: input.taskId,
    date: input.date,
    handoff: view.handoff,
    priorRunId: latest?.runId,
    cwd: cwd.cwd,
    repoName: input.repoName ?? cwd.repoName,
    jiraKey: task.jiraKey,
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
      // A refused follow-up (e.g. expired session) falls back to a fresh run.
      if (!(err instanceof AgentDispatchError)) throw err;
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
