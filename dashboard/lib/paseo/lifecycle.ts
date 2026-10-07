import { withMutex } from "@/lib/atomic-write";
import { withAgentAdmission } from "@/lib/agent-runs/claims";
import { clip } from "@/lib/agent-runs/events";
import { appendRunEvent, isActiveAgentRunState, type AgentRunStatus } from "@/lib/agent-runs/run-files";
import { listAgentRuns, readAgentRun, updateAgentRunStatus, type AgentRun } from "@/lib/agent-runs/store";
import { currentTaskNode, loadTaskIndex, type TaskIndex } from "@/lib/tasks/task-index";
import type { PaseoAgent } from "@getpaseo/client";
import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import { paseoUrl, withPaseo, type PaseoSession } from "./client";
import { AUTOCONFIRM_PROVIDERS } from "./launch";
import { sweepPaseoWorkspacesIfDue } from "./workspaces";

type TimelineEntry = FetchAgentTimelinePayload["entries"][number];

/**
 * Outcome of the turn DevHub submitted, found by the user message carrying
 * our clientMessageId. Idle alone is not success: a provider API failure
 * lands as an idle agent whose last message is the error text.
 */
export function paseoTurnOutcome(run: AgentRun, agent: PaseoAgent, entries: TimelineEntry[]): Partial<AgentRunStatus> {
  const start = entries.findIndex((entry) => entry.item.type === "user_message" && entry.item.clientMessageId === run.status.messageId);
  const following = start < 0 ? [] : entries.slice(start + 1);
  const nextUser = following.findIndex((entry) => entry.item.type === "user_message");
  const isLatestTurn = nextUser < 0;
  // A newer turn's status, permissions and usage do not belong to this run.
  if (isLatestTurn) {
    if (agent.status === "initializing" && Date.now() - run.spec.createdAt > 120_000) {
      return { state: "needs-attention", error: "The agent is still initializing after two minutes. Check its provider in Paseo." };
    }
    if (agent.status === "running" || agent.status === "initializing") {
      return { state: agent.pendingPermissions.length ? "needs-attention" : agent.status === "running" ? "running" : "starting", error: undefined };
    }
    if (agent.status === "error") return { state: "failed", finishedAt: Date.now(), error: clip(agent.lastError || "The agent reported an error.", 2000) };
    if (agent.status === "closed") return { state: "needs-attention", error: "The Paseo agent was closed before DevHub saw a result." };
    if (run.status.cancelRequestedAt) return { state: "cancelled", finishedAt: Date.now(), error: undefined };
  }

  if (start < 0) return { state: "needs-attention", error: "The submitted message could not be found in the Paseo timeline. Open the agent to inspect it." };
  const turn = isLatestTurn ? following : following.slice(0, nextUser);
  const failure = turn.find((entry) => entry.item.type === "error" || (entry.item.type === "notification" && entry.item.level === "error"));
  if (failure && (failure.item.type === "error" || failure.item.type === "notification")) {
    return { state: "failed", finishedAt: Date.now(), error: clip(failure.item.message, 2000) };
  }
  const segments: string[] = [];
  let previousMessageId: string | undefined;
  let previousWasText = false;
  for (const { item } of turn) {
    if (item.type === "assistant_message") {
      if (previousWasText && item.messageId === previousMessageId) segments[segments.length - 1] += item.text;
      else segments.push(item.text);
      previousMessageId = item.messageId;
    }
    previousWasText = item.type === "assistant_message";
  }
  const finalText = segments.map((segment) => segment.trim()).filter(Boolean).join("\n\n");
  if (!finalText) return { state: "needs-attention", error: "The turn stopped without a result. Open the agent to inspect it." };
  const usage = isLatestTurn ? agent.lastUsage : undefined;
  return {
    state: "completed", finishedAt: Date.now(), resultText: clip(finalText, 8000), error: undefined,
    ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage?.totalCostUsd !== undefined ? { costUsd: usage.totalCostUsd } : {}),
  };
}

/** Cursor/Copilot ACP still ask in their most permissive mode; DevHub runs are unattended. */
async function autoConfirm({ api }: PaseoSession, agent: PaseoAgent): Promise<number> {
  if (!agent.pendingPermissions.length || !AUTOCONFIRM_PROVIDERS.has(agent.provider)) return 0;
  const handle = api.agents.ref(agent);
  let confirmed = 0;
  for (const request of agent.pendingPermissions) {
    try {
      await handle.respondToPermission({ requestId: request.id, response: { behavior: "allow" } });
      confirmed += 1;
    } catch { /* Left as needs-attention; the next tick retries. */ }
  }
  return confirmed;
}

export async function turnEntries(daemon: PaseoSession["daemon"], agentId: string, messageId: string): Promise<TimelineEntry[]> {
  let page = await daemon.fetchAgentTimeline(agentId, { direction: "tail", limit: 500, projection: "canonical" });
  let entries = page.entries;
  const seen = new Set<string>();
  while (true) {
    if (page.error) throw new Error(page.error);
    if (page.staleCursor || page.gap) throw new Error("Paseo's timeline changed during reconciliation. Retrying on the next check.");
    if (entries.some(({ item }) => item.type === "user_message" && item.clientMessageId === messageId) || !page.hasOlder) return entries;
    const cursor = page.startCursor;
    const key = JSON.stringify(cursor);
    if (!cursor || seen.has(key) || entries.length >= 10_000) throw new Error("The conversation is too large to reconcile automatically. Open Paseo to inspect it.");
    seen.add(key);
    page = await daemon.fetchAgentTimeline(agentId, { direction: "before", cursor, limit: 500, projection: "canonical" });
    entries = [...page.entries, ...entries];
  }
}

function ownsLatestTurn(run: AgentRun, entries: TimelineEntry[]): boolean {
  const latest = entries.findLast(({ item }) => item.type === "user_message");
  return latest?.item.type === "user_message" && latest.item.clientMessageId === run.status.messageId;
}

export async function reconcilePaseoRun(input: AgentRun): Promise<AgentRun> {
  if (input.spec.runtime !== "paseo" || !isActiveAgentRunState(input.status.state)) return input;
  return withMutex(`paseo:${input.spec.id}`, async () => {
    const run = readAgentRun(input.spec.id) ?? input;
    if (!isActiveAgentRunState(run.status.state)) return run;
    const agentId = run.status.conversationId;
    if (!agentId || !run.status.messageId) {
      if (Date.now() - run.spec.createdAt < 120_000) return run;
      return updateAgentRunStatus(run, { state: "needs-attention", error: "Startup was interrupted before Paseo acknowledged the agent. Check Paseo before retrying." });
    }
    try {
      if (run.status.connectionId !== paseoUrl()) return updateAgentRunStatus(run, { state: "needs-attention", error: "This run belongs to another Paseo connection. Restore its connection before continuing." });
      const patch = await withPaseo(async (session) => {
        let fetched = await session.daemon.fetchAgent(agentId);
        if (!fetched) return { state: "needs-attention", error: "The agent is no longer available in Paseo." } satisfies Partial<AgentRunStatus>;
        const entries = await turnEntries(session.daemon, agentId, run.status.messageId!);
        if (ownsLatestTurn(run, entries) && await autoConfirm(session, fetched.agent) > 0) fetched = (await session.daemon.fetchAgent(agentId)) ?? fetched;
        return paseoTurnOutcome(run, fetched.agent, entries);
      });
      const updated = withAgentAdmission(() => {
        const latest = readAgentRun(run.spec.id) ?? run;
        if (!isActiveAgentRunState(latest.status.state)) return latest;
        if (patch.state && !isActiveAgentRunState(patch.state)) {
          const text = patch.resultText || patch.error || patch.state;
          appendRunEvent(run.dir, patch.state === "completed"
            ? { type: "text", text, seq: latest.status.eventCount, ts: Date.now() }
            : { type: "result", ok: false, text, seq: latest.status.eventCount, ts: Date.now() });
          patch.eventCount = latest.status.eventCount + 1;
        }
        return updateAgentRunStatus(latest, { ...patch, connectivity: "connected" });
      });
      return archiveFinishedPaseoReview(updated);
    } catch (error) {
      const latest = readAgentRun(run.spec.id) ?? run;
      if (!isActiveAgentRunState(latest.status.state)) return latest;
      return updateAgentRunStatus(latest, { connectivity: "reconnecting", error: error instanceof Error ? error.message : "Paseo is unavailable." });
    }
  });
}

/**
 * Finished review chats leave Paseo's sidebar so it stays about live work. Failures
 * are retried on the next reconcile tick; a missing agent counts as archived.
 */
export async function archiveFinishedPaseoReview(run: AgentRun): Promise<AgentRun> {
  const action = run.spec.activity?.action;
  if (run.spec.runtime !== "paseo" || (action !== "review" && action !== "pr-review")) return run;
  if (isActiveAgentRunState(run.status.state) || run.status.sidebarArchivedAt || !run.status.conversationId) return run;
  const agentId = run.status.conversationId;
  try {
    if (run.status.connectionId !== paseoUrl()) return run;
    const archived = await withPaseo(async ({ daemon }) => {
      const fetched = await daemon.fetchAgent(agentId);
      if (!fetched || fetched.agent.archivedAt) return true;
      if (fetched.agent.status === "running" || fetched.agent.status === "initializing" || fetched.agent.pendingPermissions.length) return false;
      if (!run.status.messageId || !ownsLatestTurn(run, await turnEntries(daemon, agentId, run.status.messageId))) return false;
      await daemon.archiveAgent(agentId);
      return true;
    });
    return archived ? updateAgentRunStatus(run, { sidebarArchivedAt: Date.now() }) : run;
  } catch {
    return run;
  }
}

/**
 * A task chat stays pinned while it's the live part of the task: a plan until
 * implementation starts, every chat until the task is done, abandoned or deleted.
 */
export function taskPinReleased(run: AgentRun, runs: readonly AgentRun[], tasks: TaskIndex): boolean {
  const taskId = run.spec.activity?.taskId;
  if (!taskId) return true;
  const task = currentTaskNode(tasks, taskId)?.task;
  if (!task || task.done || task.abandonedAt) return true;
  return run.spec.activity?.action === "plan" && runs.some((other) =>
    other.spec.activity?.taskId === taskId && other.spec.activity.action === "implement"
    && other.spec.createdAt > run.spec.createdAt && Boolean(other.status.conversationId));
}

/** Unpins a workspace DevHub pinned once its task moves on. Failures retry on the next tick. */
export async function releaseTaskWorkspacePin(run: AgentRun, runs: readonly AgentRun[], tasks: TaskIndex): Promise<AgentRun> {
  const workspaceId = run.status.pinnedWorkspaceId;
  if (!workspaceId || run.status.workspaceUnpinnedAt || !taskPinReleased(run, runs, tasks)) return run;
  try {
    if (run.status.connectionId !== paseoUrl()) return run;
    await withPaseo(({ daemon }) => daemon.setWorkspacePinned(workspaceId, false));
  } catch (error) {
    // A deleted workspace has no pin left to release.
    if (!(error instanceof Error && error.message === "Workspace not found")) return run;
  }
  return updateAgentRunStatus(run, { workspaceUnpinnedAt: Date.now() });
}

export async function cancelPaseoRun(input: AgentRun) {
  const run = await reconcilePaseoRun(input);
  if (!isActiveAgentRunState(run.status.state)) return { run, outcome: "already-finished" as const };
  const agentId = run.status.conversationId;
  if (!agentId) throw new Error("Open Paseo to inspect this interrupted start; there is no acknowledged agent to stop.");
  if (run.status.connectionId !== paseoUrl()) throw new Error("Restore this run's original Paseo connection before stopping it.");
  await withPaseo(async ({ daemon }) => {
    if (!run.status.messageId || !ownsLatestTurn(run, await turnEntries(daemon, agentId, run.status.messageId))) throw new Error("This chat has a different active turn. Stop it from Paseo.");
    await daemon.cancelAgent(agentId);
  });
  const updated = updateAgentRunStatus(run, { cancelRequestedAt: Date.now() });
  return { run: await reconcilePaseoRun(updated), outcome: "cancel-requested" as const };
}

const AIONUI_REMOVED = "AionUi was removed from DevHub, so this run can't be followed any more. Start it again from its task.";

/** Every managed run, including records AionUi left behind. */
export async function reconcileManagedRun(run: AgentRun): Promise<AgentRun> {
  if (run.spec.runtime === "aionui") {
    return isActiveAgentRunState(run.status.state) ? updateAgentRunStatus(run, { state: "needs-attention", error: AIONUI_REMOVED }) : run;
  }
  return reconcilePaseoRun(run);
}

export async function cancelManagedRun(run: AgentRun) {
  if (run.spec.runtime === "aionui") {
    if (!isActiveAgentRunState(run.status.state)) return { run, outcome: "already-finished" as const };
    return { run: updateAgentRunStatus(run, { state: "cancelled", finishedAt: Date.now(), error: AIONUI_REMOVED }), outcome: "cancel-requested" as const };
  }
  return cancelPaseoRun(run);
}

let timer: ReturnType<typeof setInterval> | undefined;
let polling = false;

/** Follows active runs to a result and retries review archiving and task unpinning; one tick at a time. */
export function startAgentReconciliation(): void {
  if (timer) return;
  const tick = async () => {
    if (polling) return;
    polling = true;
    try {
      const runs = listAgentRuns(Number.MAX_SAFE_INTEGER);
      // Read every task file only on ticks that have a pin to check.
      let tasks: TaskIndex | undefined;
      for (const run of runs) {
        if (run.spec.runtime !== "paseo" && run.spec.runtime !== "aionui") continue;
        const current = isActiveAgentRunState(run.status.state) ? await reconcileManagedRun(run) : await archiveFinishedPaseoReview(run);
        if (current.status.pinnedWorkspaceId && !current.status.workspaceUnpinnedAt) {
          tasks ??= loadTaskIndex();
          await releaseTaskWorkspacePin(current, runs, tasks);
        }
      }
      await sweepPaseoWorkspacesIfDue();
    } finally { polling = false; }
  };
  timer = setInterval(() => { void tick().catch((error: unknown) => console.error("[agents] reconciliation failed", error)); }, 5_000);
  timer.unref();
}
