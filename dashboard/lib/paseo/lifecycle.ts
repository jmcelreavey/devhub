import { withMutex } from "@/lib/atomic-write";
import { blocksToText } from "@/lib/markdown-convert";
import { getVaultStorage } from "@/lib/vault/vault-registry";
import { withAgentAdmission } from "@/lib/agent-runs/claims";
import { clip } from "@/lib/agent-runs/events";
import { appendRunEvent, isActiveAgentRunState, type AgentRunStatus } from "@/lib/agent-runs/run-files";
import { listAgentRuns, listCapacityRuns, readAgentRun, updateAgentRunStatus, type AgentRun } from "@/lib/agent-runs/store";
import { currentTaskNode, loadTaskIndex, type TaskIndex } from "@/lib/tasks/task-index";
import type { PaseoAgent } from "@getpaseo/client";
import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import { paseoUrl, withPaseo, type PaseoSession } from "./client";
import { AUTOCONFIRM_PROVIDERS } from "./launch";
import { releaseIdlePaseoRuntimesIfDue } from "./idle-runtimes";
import { sweepPaseoWorkspacesIfDue } from "./workspaces";

type TimelineEntry = FetchAgentTimelinePayload["entries"][number];

function reviewNoteProblem(notePath: string, startedAt: number): string | undefined {
  try {
    const note = getVaultStorage("notes").read(notePath);
    if (note && note.modified >= startedAt) {
      const text = typeof note.content === "string" ? note.content : Array.isArray(note.content) ? blocksToText(note.content) : "";
      // The row's old note action created headings, links and empty bullets. That is not a review.
      const body = text.split(/(?=^#{1,6} )/m).filter((section) => !/^## Links\s*$/m.test(section))
        .join("\n").split("\n").filter((line) => !/^#|^\*\*PR:\*\*/.test(line.trim()))
        .map((line) => line.replace(/^\s*[-*]\s*$/, "").trim()).join("").trim();
      if (body.length > 0) return;
    }
    return "The agent stopped, but a finished PR review note was not saved. Open the agent to inspect or retry it.";
  } catch (error) {
    return `The saved PR review note could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Outcome of the turn DevHub submitted, found by the user message carrying
 * our clientMessageId. Idle alone is not success: a provider API failure
 * lands as an idle agent whose last message is the error text. An idle or
 * closed agent with no result is finished, not "needs attention": nothing is
 * left running to wait for, and an active state would hold capacity forever.
 */
export function paseoTurnOutcome(run: AgentRun, agent: PaseoAgent, entries: TimelineEntry[]): Partial<AgentRunStatus> {
  const start = entries.findIndex((entry) => entry.item.type === "user_message" && entry.item.clientMessageId === run.status.messageId);
  const following = start < 0 ? [] : entries.slice(start + 1);
  const nextUser = following.findIndex((entry) => entry.item.type === "user_message" && !run.status.steeringMessageIds?.includes(entry.item.clientMessageId ?? ""));
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
    if (run.status.cancelRequestedAt) return { state: "cancelled", finishedAt: Date.now(), error: undefined };
  }

  // A closed agent can still have finished its turn first, so only an empty turn is lost.
  const lost = (error: string): Partial<AgentRunStatus> => ({
    state: "failed", finishedAt: Date.now(),
    error: agent.status === "closed" ? "The Paseo agent was closed before DevHub saw a result." : error,
  });
  if (start < 0) return lost("The submitted message could not be found in the Paseo timeline and the agent is idle. Open it in Paseo to see what it did.");
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
  if (!finalText) return lost("The turn stopped without a result. Open the agent in Paseo to inspect it.");
  // Cursor ACP can emit provider failures as assistant text rather than an error event.
  const finalMessage = segments.at(-1)?.trim() ?? "";
  if (/^Error: RetriableError:/.test(finalMessage)) {
    return { state: "failed", finishedAt: Date.now(), resultText: clip(finalText, 8000), error: clip(finalMessage, 2000) };
  }
  const activity = run.spec.activity;
  if (activity?.prUrl && activity.notePath && (activity.action === "review" || activity.action === "pr-review")) {
    const problem = reviewNoteProblem(activity.notePath, run.status.startedAt ?? run.spec.createdAt);
    if (problem) return { state: "failed", finishedAt: Date.now(), resultText: clip(finalText, 8000), error: clip(problem, 2000) };
  }
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
  const latest = entries.findLast(({ item }) => item.type === "user_message" && !run.status.steeringMessageIds?.includes(item.clientMessageId ?? ""));
  return latest?.item.type === "user_message" && latest.item.clientMessageId === run.status.messageId;
}

export async function reconcilePaseoRun(input: AgentRun): Promise<AgentRun> {
  if (input.spec.runtime !== "paseo" || !isActiveAgentRunState(input.status.state)) return input;
  return withMutex(`paseo:${input.spec.id}`, async () => {
    const run = readAgentRun(input.spec.id) ?? input;
    if (!isActiveAgentRunState(run.status.state)) return run;
    const agentId = run.status.conversationId;
    if (!agentId || !run.status.messageId) {
      // A launch still in its first two minutes cannot be freed by another probe.
      if (Date.now() - run.spec.createdAt < 120_000) {
        noteCapacityProbe(run.spec.id);
        return run;
      }
      return updateAgentRunStatus(run, { state: "needs-attention", error: "Startup was interrupted before Paseo acknowledged the agent. Check Paseo before retrying." });
    }
    try {
      if (run.status.connectionId !== paseoUrl()) return updateAgentRunStatus(run, { state: "needs-attention", error: "This run belongs to another Paseo connection. Restore its connection before continuing." });
      const patch = await withPaseo(async (session) => {
        let fetched = await session.daemon.fetchAgent(agentId);
        if (!fetched) return { state: "failed", finishedAt: Date.now(), error: "The agent is no longer available in Paseo." } satisfies Partial<AgentRunStatus>;
        const entries = await turnEntries(session.daemon, agentId, run.status.messageId!);
        if (!run.spec.activity?.taskId && ownsLatestTurn(run, entries) && await autoConfirm(session, fetched.agent) > 0) fetched = (await session.daemon.fetchAgent(agentId)) ?? fetched;
        return paseoTurnOutcome(run, fetched.agent, entries);
      });
      noteCapacityProbe(run.spec.id);
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
      noteCapacityProbe(run.spec.id);
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
 * One pinned chat per task: the newest one. Auto mode (and retries) start a fresh chat for each step, which is
 * cheaper than dragging an earlier step's whole history along, so an older chat unpins as soon as a newer chat
 * for the same task has started. Every chat unpins once the task is done, abandoned or deleted.
 */
export function taskPinReleased(run: AgentRun, runs: readonly AgentRun[], tasks: TaskIndex): boolean {
  const taskId = run.spec.activity?.taskId;
  if (!taskId) return true;
  const task = currentTaskNode(tasks, taskId)?.task;
  if (!task || task.done || task.abandonedAt) return true;
  return runs.some((other) =>
    other.spec.activity?.taskId === taskId
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
    return isActiveAgentRunState(run.status.state) ? updateAgentRunStatus(run, { state: "failed", finishedAt: Date.now(), error: AIONUI_REMOVED }) : run;
  }
  return reconcilePaseoRun(run);
}

/** A dispatch that follows the reconcile tick should not open another socket per run. */
const CAPACITY_PROBE_FRESH_MS = 4_000;
const capacityProbeAt = new Map<string, number>();

export function clearCapacityProbeCache(): void {
  capacityProbeAt.clear();
}

function noteCapacityProbe(runId: string): void {
  capacityProbeAt.set(runId, Date.now());
}

/** Re-checks runs holding a slot, skipping ones this process probed in the last few seconds. */
export async function reconcileCapacityRuns(): Promise<void> {
  const now = Date.now();
  const active = listCapacityRuns();
  const activeIds = new Set(active.map((run) => run.spec.id));
  for (const id of capacityProbeAt.keys()) if (!activeIds.has(id)) capacityProbeAt.delete(id);
  // Healthy running chats were just polled. Needs-attention and other non-running
  // slots are the ones a stale Paseo session can pin, so those are always re-checked.
  const due = active.filter((run) => run.status.state !== "running" || now - (capacityProbeAt.get(run.spec.id) ?? 0) >= CAPACITY_PROBE_FRESH_MS);
  await Promise.all(due.map((run) => reconcileManagedRun(run).catch(() => run)));
}

/**
 * Stops DevHub counting a run it can no longer follow. Nothing in Paseo is
 * stopped: a run that is still live has to be cancelled instead.
 */
export async function clearManagedRun(input: AgentRun) {
  const run = await reconcileManagedRun(input);
  if (!isActiveAgentRunState(run.status.state)) return { run, outcome: "already-finished" as const };
  const unfollowable = run.status.state === "needs-attention" || run.status.connectivity === "reconnecting";
  if (!unfollowable) return { run, outcome: "still-running" as const };
  const was = run.status.error ? ` Last status: ${run.status.error}` : "";
  return {
    run: updateAgentRunStatus(run, { state: "cancelled", finishedAt: Date.now(), error: clip(`Cleared from DevHub's active list. The Paseo agent was not stopped.${was}`, 2000) }),
    outcome: "cleared" as const,
  };
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
      // Idle chats keep a provider process and its MCP servers alive until archived.
      await releaseIdlePaseoRuntimesIfDue();
    } finally { polling = false; }
  };
  const fire = () => { void tick().catch((error: unknown) => console.error("[agents] reconciliation failed", error)); };
  timer = setInterval(fire, 5_000);
  timer.unref();
  // Runs that ended while DevHub was down shouldn't hold capacity for another interval.
  fire();
}
