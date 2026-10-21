/** Server-owned dispatch. Starting work never opens or targets a user interface. */
import { agentBudgets,costRefusalMessage,spentToday } from "@/lib/agent-runs/budget";
import { createRunWorktree,gitHead,type AgentWorktreeLabel } from "@/lib/agent-runs/git";
import { agentRunTitle } from "./title";
import { prepareImplementationCheckout, checkoutPreparationPrompt } from "./checkout";
import { withTaskOwnerNotes } from "@/lib/tasks/owner-notes-server";
import { parseJiraIssueKey } from "@/lib/entity-note";
import { ensureTasksMigrated, getTasks } from "@/lib/tasks/storage";
import { findTask } from "@shared/tasks/store.ts";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { isActiveAgentRunState,writeRunSpec,type AgentActivityContext,type AgentRunWorktree } from "@/lib/agent-runs/run-files";
import {
agentRunDir,
createAgentRun,
listAgentRuns,
listCapacityRuns,
newAgentRunId,
readAgentRun,
updateAgentRunStatus,
type AgentRun,
} from "@/lib/agent-runs/store";
import { patchTaskAgentRun, taskRunRole, upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";
import { fillFromTier, type ModelTier } from "@/lib/storyboard/model-tiers-shared";
import { taskTierChoice, type TaskTierChoice } from "@/lib/storyboard/task-tiers";
import { worktreeFingerprint } from "@/lib/workflows/fingerprint";
import { openPaseoSession, paseoUrl } from "@/lib/paseo/client";
import { startPaseoAgent } from "@/lib/paseo/dispatch";
import { reconcileCapacityRuns } from "@/lib/paseo/lifecycle";
import { resolvePaseoLaunch } from "@/lib/paseo/launch";
import { preferredPaseoProvider } from "@/lib/paseo/managed";
import { listPaseoProviders, thinkingOptionsForModel } from "@/lib/paseo/providers";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimAgentRequest,readAgentRequest,withAgentAdmission } from "./claims";

export class AgentDispatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Lets a client offer a way out of the refusal rather than only its text. */
    readonly code?: "capacity",
  ) {
    super(message);
    this.name = "AgentDispatchError";
  }
}

export interface AgentDispatchInput {
  planScope?: { taskId: string; date: string };
  requestId?: string;
  activity?: AgentActivityContext;
  provider: string;
  prompt: string;
  cwd: string;
  title?: string;
  model?: string;
  /** Reasoning effort. Blank sends the provider default. */
  effort?: string;
  /** Run in an isolated git worktree instead of the checkout itself. */
  worktree?: boolean;
  /** Auto sets this for fresh checkout launches, never for review/fix continuations. */
  prepareCheckout?: boolean;
  maxTurns?: number;
  /**
   * Caller's nesting level, forwarded by the MCP server from DEVHUB_AGENT_DEPTH.
   * A recursion guard against agents fanning out by accident — not a security
   * boundary, since a caller controls what it sends.
   */
  depth: number;
  parentRunId?: string;
  resumeSessionId?: string;
  /** Follow-ups keep the parent's worktree and diff baseline. */
  inherit?: { baseSha?: string; worktree?: AgentRunWorktree };
  /**
   * Set only by the scheduler for a job a human already approved. That approval
   * is the checkpoint the first-run chip exists for, and nobody is at the dock
   * to click it at 3am. Server-internal: the dispatch API schema cannot set it.
   */
  scheduledJobId?: string;
  /**
   * Same idea for other server-internal jobs the user already opted into (the
   * auto-review poller): the reason stands in for the first-run chip.
   */
  unattendedReason?: string;
  /**
   * The implement flow's assigned reviewer, started by an implementing agent.
   * Allowed one nesting level deeper than other runs, so a review can hang off
   * an implement run but nothing can hang off the review. Server-internal: the
   * dispatch API schema cannot set it.
   */
  reviewRun?: boolean;
  /** Tier picked at launch (the inline tier control); its agent/model fill the blanks instead of the step default. */
  tier?: ModelTier;
  /** Server-internal: why auto mode picked `tier` (escalated after a failure, a large diff, a trivial step). */
  tierReason?: string;
  /** Server-internal: the model tier this task run ended up on (set by withTaskTier). */
  tierUsed?: { step: string; tier: string };
}

/**
 * A task's run takes its step's model tier for whatever the caller left blank
 * (lib/storyboard/task-tiers.ts), so plan, implement, review and fix runs each
 * use their mapped tier. A continued session keeps its own provider, and a
 * scheduled job is not task work.
 */
const hasPickedTier = (input: AgentDispatchInput) => input.tier !== undefined;

export function withTaskTier(
  input: AgentDispatchInput,
  choose: (taskId: string, action: string, picked?: ModelTier) => TaskTierChoice = (taskId, action, picked) => taskTierChoice(taskId, action, undefined, picked),
  preferred: () => string = preferredPaseoProvider,
): AgentDispatchInput {
  const taskId = input.activity?.taskId;
  if (!taskId || input.resumeSessionId || input.scheduledJobId) return input;
  let choice: TaskTierChoice;
  try {
    // The raw action, not the run role: create-pr is the PR step even though its run is implement work.
    choice = hasPickedTier(input) ? choose(taskId, input.activity?.action ?? "agent", input.tier) : choose(taskId, input.activity?.action ?? "agent");
  } catch {
    return input;
  }
  const filled = fillFromTier(input, choice, preferred());
  return {
    ...input,
    provider: filled.provider,
    ...(filled.model ? { model: filled.model } : {}),
    ...(filled.effort ? { effort: filled.effort } : {}),
    ...(filled.onTier && !choice.override ? { tierUsed: { step: choice.step, tier: choice.tier } } : {}),
  };
}


function worktreeLabelForDispatch(input: AgentDispatchInput, title: string): AgentWorktreeLabel {
  const task = input.activity?.taskId && input.activity.taskDate
    ? getTasks(input.activity.taskDate).find((item) => item.id === input.activity?.taskId)
    : undefined;
  const fromText = parseJiraIssueKey(task?.jiraKey || task?.text || title || "");
  return {
    repoName: input.activity?.repoName,
    jiraKey: task?.jiraKey || fromText || undefined,
    title: task?.text || title,
  };
}

function envInt(key: string, fallback: number): number {
  const n = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * DEVHUB_AGENT_ALLOWED_ROOTS narrows where dispatches may land (colon-separated
 * directories, `~` allowed). Unset keeps the historical $HOME-wide rule.
 */
export function cwdAllowedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.DEVHUB_AGENT_ALLOWED_ROOTS ?? "")
    .split(":")
    .map((root) => root.trim())
   .filter(Boolean)
    .map((root) => path.resolve(root.replace(/^~(?=$|\/)/, os.homedir())));
}

/** Same rule as the PTY peer: an existing directory under $HOME. */
export function validateAgentCwd(raw: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = os.homedir();
  let resolved = path.resolve(raw.replace(/^~(?=$|\/)/, home));
  try { resolved = fs.realpathSync(resolved); } catch { throw new AgentDispatchError("The working directory does not exist.", 400); }
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new AgentDispatchError(`cwd must be inside ${home}`, 400);
  }
  const roots = cwdAllowedRoots(env);
  if (roots.length > 0 && !roots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    throw new AgentDispatchError(
      `cwd is outside DEVHUB_AGENT_ALLOWED_ROOTS (${roots.join(", ")}) — dispatch there or extend the list.`,
      400,
    );
  }
  let isDir = false;
  try {
    isDir = fs.statSync(resolved).isDirectory();
  } catch {
    /* reported below */
  }
  if (!isDir) throw new AgentDispatchError(`cwd does not exist or is not a directory: ${resolved}`, 400);
  return resolved;
}

const REVIEW_MCP_SERVERS = ["devhub", "lean-ctx"] as const;

/** Keep review conversations below Cursor ACP's tool cap so Jira stays visible. */
export function mcpServersForActivity(action: string | undefined): readonly string[] | undefined {
  return action === "review" || action === "pr-review" ? REVIEW_MCP_SERVERS : undefined;
}

/** DevHub's own MCP only; harnesses bring the user's MCP config themselves. */
const PASEO_DEFAULT_MCP = ["devhub"] as const;

export function maxActiveAgentRuns(): number {
  return envInt("DEVHUB_AGENT_MAX_RUNS", 6);
}


function logAgentTiming(step: string, started: number, detail?: string): void {
  console.info(`[agent-dispatch] ${step} ${Math.round(performance.now() - started)}ms${detail ? ` ${detail}` : ""}`);
}

export interface AgentDispatchOptions {
  /**
   * Return once the run record is durable. Worktree creation and the Paseo
   * start continue in the background so Start chat can leave the sheet.
   */
  defer?: boolean;
}

interface FinishDispatch {
  input: AgentDispatchInput;
  run: AgentRun;
  launch: ReturnType<typeof resolvePaseoLaunch>;
  cwd: string;
  id: string;
  parent: AgentRun | null;
  started: number;
}

/** Worktree, model setup and the Paseo create. Safe to run after the HTTP response. */
async function finishDispatchedRun(ctx: FinishDispatch): Promise<AgentRun> {
  let { run, cwd } = ctx;
  const { input, launch, id, parent } = ctx;
  const connecting = openPaseoSession();
  // Handle an early rejection while git is pending; awaiting the original below still reports it.
  void connecting.catch(() => undefined);
  try {
    if (input.activity?.taskId && isTaskOwnershipBlocked(findTask(getActiveTasksDir(), input.activity.taskId))) throw new AgentDispatchError("This task's ownership is pending or handed off and is read-only.", 409);
    if (input.activity?.taskId) {
      await upsertTaskAgentRun({
        taskId: input.activity.taskId, role: taskRunRole(input.activity.action), runId: id, status: "queued", provider: launch.provider,
        ...(run.spec.model ? { model: run.spec.model } : {}), ...(input.tierUsed ? { tier: input.tierUsed } : {}),
      });
    }

    const inherit = input.resumeSessionId && parent ? { worktree: parent.spec.worktree, baseSha: parent.spec.baseSha } : input.inherit;
    if (input.resumeSessionId && parent) cwd = validateAgentCwd(parent.spec.cwd);
    let worktree = inherit?.worktree;
    let baseSha = inherit?.baseSha;
    // Isolation is the default: a caller that means to edit the live checkout
    // says worktree: false. DEVHUB_AGENT_DEFAULT_WORKTREE=0 restores the old
    // shared-checkout-by-default behaviour.
    const wantWorktree = input.worktree ?? envInt("DEVHUB_AGENT_DEFAULT_WORKTREE", 1) !== 0;
    if (!inherit) {
      if (wantWorktree) {
        run = updateAgentRunStatus(run, { startupPhase: "worktree" });
        const worktreeStarted = performance.now();
        try {
          const created = await createRunWorktree(cwd, id, worktreeLabelForDispatch(input, run.spec.title));
          worktree = created.worktree;
          baseSha = created.baseSha;
          cwd = created.cwd;
        } catch (err) { throw new AgentDispatchError(err instanceof Error ? err.message : String(err), 400); }
        logAgentTiming("worktree", worktreeStarted, `run=${id}`);
      } else {
        run = updateAgentRunStatus(run, { startupPhase: "agent" });
        const headStarted = performance.now();
        const prepare = input.prepareCheckout ?? (input.worktree === false && input.activity?.action === "implement" && !input.parentRunId && !input.resumeSessionId);
        if (prepare) {
          const receipt = await prepareImplementationCheckout(cwd, id, {
            record: (checkoutPreparation) => {
              run.spec = { ...run.spec, checkoutPreparation };
              writeRunSpec(run.dir, run.spec);
            },
          });
          baseSha = receipt.baseSha;
        } else {
          baseSha = await gitHead(cwd);
        }
        logAgentTiming("git-head", headStarted, `run=${id}`);
      }
    }

    run.spec = { ...run.spec, cwd, baseSha, worktree };
    writeRunSpec(run.dir, run.spec);
    if (input.activity?.taskId) {
      await patchTaskAgentRun(input.activity.taskId, id, { cwd, ...(input.activity.action === "review" ? { codeFingerprint: await worktreeFingerprint(cwd) } : {}) });
    }
    run = updateAgentRunStatus(run, { startupPhase: "agent" });
    const session = await connecting;
    if (input.activity?.taskId && isTaskOwnershipBlocked(findTask(getActiveTasksDir(), input.activity.taskId))) throw new AgentDispatchError("This task's ownership is pending or handed off and is read-only.", 409);
    if (readAgentRun(id)?.status.state === "cancelled") throw new AgentDispatchError("This run was cancelled before it started.", 409);
    const paseoStarted = performance.now();
    const startedAgent = await startPaseoAgent({
      run, launch, prompt: withTaskOwnerNotes(run.spec.checkoutPreparation ? `${input.prompt}\n\n${checkoutPreparationPrompt(run.spec.checkoutPreparation)}` : input.prompt, input.activity?.taskId), resumeAgentId: input.resumeSessionId, session,
      // Only the send/create can lose its ack. A failed connection or preflight
      // must release capacity instead of leaving an ambiguous active run.
      onSubmission: (messageId) => { run = updateAgentRunStatus(run, { submissionAttemptedAt: Date.now(), messageId }); },
    });
    logAgentTiming("paseo", paseoStarted, `run=${id}`);
    const ready = updateAgentRunStatus(run, {
      state: "running", startedAt: Date.now(), conversationId: startedAgent.agentId, sessionId: startedAgent.agentId,
      messageId: startedAgent.messageId, pinnedWorkspaceId: startedAgent.pinnedWorkspaceId, startupPhase: undefined,
    });
    logAgentTiming("ready", ctx.started, `run=${id} state=running`);
    return ready;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    run = readAgentRun(id) ?? run;
    // Paseo creates the agent and submits the prompt in one request, so any failure after it went out may have landed.
    const ambiguous = run.status.submissionAttemptedAt !== undefined;
    const failed = updateAgentRunStatus(run, { state: ambiguous ? "needs-attention" : "failed", ...(ambiguous ? {} : { finishedAt: Date.now() }), error: message, startupPhase: undefined });
    logAgentTiming("ready", ctx.started, `run=${id} state=${failed.status.state}`);
    return failed;
  } finally {
    void connecting.then((opened) => opened.close()).catch(() => undefined);
  }
}

export async function dispatchAgentRun(request: AgentDispatchInput, options?: AgentDispatchOptions): Promise<AgentRun> {
  const dispatchStarted = performance.now();
  const input = withTaskTier(request);
  await ensureTasksMigrated();
  if (input.activity?.taskId && isTaskOwnershipBlocked(findTask(getActiveTasksDir(), input.activity.taskId))) throw new AgentDispatchError("This task's ownership is pending or handed off and is read-only.", 409);
  if (!input.prompt.trim() || input.prompt.length > 32_000) throw new AgentDispatchError("A prompt between 1 and 32,000 characters is required.", 400);
  const maxDepth = envInt("DEVHUB_AGENT_MAX_DEPTH", 1) + (input.reviewRun ? 1 : 0);
  if (input.depth >= maxDepth) {
    throw new AgentDispatchError(
      `Nested dispatch refused: the caller is already an agent run (depth ${input.depth}, DEVHUB_AGENT_MAX_DEPTH=${maxDepth}).`,
      409,
    );
  }

  // Custom Paseo thinking ids and Cursor's effort variants come from the live provider snapshot.
  const requested = (input.provider?.trim() || preferredPaseoProvider()).toLowerCase();
  const providerId = requested === "chatgpt" ? "codex" : requested;
  let providers: Awaited<ReturnType<typeof listPaseoProviders>> | undefined;
  let thinkingOptions: { id: string; label: string }[] | undefined;
  let availableModels: string[] | undefined;
  if (input.effort?.trim() || providerId === "cursor") {
    try { providers = await listPaseoProviders(); } catch (error) {
      throw new AgentDispatchError(error instanceof Error ? error.message : "Paseo is unavailable.", 503);
    }
    const provider = providers.find((row) => row.id === providerId);
    thinkingOptions = thinkingOptionsForModel(providers, providerId, input.model);
    availableModels = provider?.models;
  }

  let launch: ReturnType<typeof resolvePaseoLaunch>;
  try {
    launch = resolvePaseoLaunch({
      provider: input.provider?.trim() || preferredPaseoProvider(), model: input.model, effort: input.effort, thinkingOptions, availableModels, depth: input.depth,
      mcpNames: mcpServersForActivity(input.activity?.action) ?? PASEO_DEFAULT_MCP,
      runtimePlugins: mcpServersForActivity(input.activity?.action) == null,
      planScope: input.planScope,
    });
  } catch (error) { throw new AgentDispatchError(error instanceof Error ? error.message : String(error), 400); }
  let connectionId: string;
  try { connectionId = paseoUrl(); } catch (error) { throw new AgentDispatchError(error instanceof Error ? error.message : String(error), 503); }
  const model = launch.model;

  if (input.requestId) {
    const existingId = readAgentRequest(input.requestId);
    if (existingId) {
      const existing = readAgentRun(existingId);
      if (!existing) throw new AgentDispatchError("This request was already claimed. Check Activity before retrying.", 409);
      if (existing.spec.prompt !== input.prompt || existing.spec.model !== model || (existing.spec.reasoningEffort ?? "") !== (launch.config.thinkingOptionId ?? "")) throw new AgentDispatchError("This request already started with different content. Open its activity or start a new handoff.", 409);
      return existing;
    }
  }
  if (input.maxTurns !== undefined) throw new AgentDispatchError("Paseo doesn't support DevHub's max-turns override. Use the agent's own controls in Paseo.", 400);
  const parent = input.parentRunId ? readAgentRun(input.parentRunId) : null;
  if (input.resumeSessionId && (!parent || parent.spec.runtime !== "paseo" || parent.status.connectionId !== connectionId || parent.status.conversationId !== input.resumeSessionId || parent.spec.provider !== launch.provider)) {
    throw new AgentDispatchError("This session cannot be continued in the current agent runtime. Start a new conversation with its saved handoff.", 400);
  }

  const providersStarted = performance.now();
  const maxActive = maxActiveAgentRuns();
  // Refuse on what Paseo says now, not on runs whose agent has since gone idle.
  // Overlap that probe with the provider snapshot; a probe from the last few seconds is reused.
  const holdingBefore = listCapacityRuns();
  const reconcileStarted = performance.now();
  const reconcilePromise = holdingBefore.length >= maxActive ? reconcileCapacityRuns() : Promise.resolve();
  try {
    if (providers) await reconcilePromise;
    else [providers] = await Promise.all([listPaseoProviders(), reconcilePromise]);
  } catch (error) {
    throw new AgentDispatchError(error instanceof Error ? error.message : "Paseo is unavailable.", 503);
  }
  if (!providers) throw new AgentDispatchError("Paseo is unavailable.", 503);
  logAgentTiming("providers", providersStarted);
  logAgentTiming("reconcile", reconcileStarted, holdingBefore.length >= maxActive ? `runs=${holdingBefore.length}` : "skipped");
  const provider = providers.find((row) => row.id === launch.provider);
  if (!provider?.ready) throw new AgentDispatchError(provider?.error || "The selected agent is not ready. Check Agents → Connection.", 400);

  const budgets = agentBudgets();
  if (budgets.maxCostUsd > 0) {
    const spent = spentToday(listAgentRuns(Number.MAX_SAFE_INTEGER));
    if (spent >= budgets.maxCostUsd) {
      throw new AgentDispatchError(costRefusalMessage(spent, budgets.maxCostUsd), 429);
    }
  }

  const cwd = validateAgentCwd(input.cwd);
  const id = newAgentRunId();
  const dir = agentRunDir(id);
  if (!dir) throw new Error(`Generated an invalid run id: ${id}`);
  let alreadyClaimed = false;
  let run = withAgentAdmission(() => {
  const priorId = input.requestId ? readAgentRequest(input.requestId) : null;
  if (priorId) {
    const prior = readAgentRun(priorId);
    if (!prior || prior.spec.prompt !== input.prompt || prior.spec.model !== model || (prior.spec.reasoningEffort ?? "") !== (launch.config.thinkingOptionId ?? "")) throw new AgentDispatchError("This request was already claimed with different content. Check Activity.", 409);
    alreadyClaimed = true;
    return prior;
  }
  if (input.resumeSessionId && listAgentRuns(Number.MAX_SAFE_INTEGER).some((active) => active.spec.runtime === "paseo" && active.status.conversationId === input.resumeSessionId && isActiveAgentRunState(active.status.state))) {
    throw new AgentDispatchError("This conversation already has an active DevHub run. Wait for it before continuing.", 409);
  }
  const holding = listCapacityRuns();
  if (holding.length >= maxActive) {
    const counted = holding.map((held) => `${held.spec.title.slice(0, 50)} (${held.status.state})`).join("; ");
    throw new AgentDispatchError(`${maxActive} agent runs are already active: ${counted}. Wait for one, stop it, or clear a stale one.`, 429, "capacity");
  }
  if (input.requestId) {
    const claimed = claimAgentRequest(input.requestId, id);
    if (claimed !== id) {
      const existing = readAgentRun(claimed);
      if (existing) { alreadyClaimed = true; return existing; }
      throw new AgentDispatchError("This request was already claimed. Check Activity before retrying.", 409);
    }
  }

  return createAgentRun({ id, schemaVersion: 2, runtime: "paseo", requestId: input.requestId,
    activity: input.activity ?? { source: input.scheduledJobId ? "schedule" : input.unattendedReason ? "investigation" : "interactive", action: "agent", jobId: input.scheduledJobId },
    provider: launch.provider, providerLabel: launch.provider, bin: "paseo", args: [], format: "text", cwd,
    title: agentRunTitle(input), prompt: input.prompt, model,
    ...(launch.config.thinkingOptionId ? { reasoningEffort: launch.config.thinkingOptionId } : {}),
    depth: input.depth, createdAt: Date.now(), parentRunId: input.parentRunId,
  });
  });
  if (alreadyClaimed) return run;
  run = updateAgentRunStatus(run, { state: "starting", connectionId, connectivity: "connected", ...(input.resumeSessionId ? { conversationId: input.resumeSessionId, sessionId: input.resumeSessionId } : {}) });
  const finish = () => finishDispatchedRun({ input, run, launch, cwd, id, parent, started: dispatchStarted });
  if (options?.defer) {
    void finish().catch((error: unknown) => console.error("[agent-dispatch] background start failed", error));
    logAgentTiming("returned", dispatchStarted, `run=${run.spec.id} deferred`);
    return run;
  }
  return finish();
}
