import { withMutex } from "@/lib/atomic-write";
import { appendRunEvent, isActiveAgentRunState, type AgentRunStatus } from "@/lib/agent-runs/run-files";
import { listAgentRuns, readAgentRun, updateAgentRunStatus, type AgentRun } from "@/lib/agent-runs/store";
import { clip } from "@/lib/agent-runs/events";
import { AionClient, AionRequestError } from "./client";
import { activeRuntimeState, conversationWantsAutoconfirm, type AionConversation, type aionMessageSchema } from "./contracts";
import { aionConnectionId } from "./connection";
import { currentAionSession, readAionSession } from "./session";
import type { z } from "zod";
import { indexAionConversations } from "./conversation-index";
import { withAgentAdmission } from "@/lib/agent-runs/claims";

type Message = z.infer<typeof aionMessageSchema>;

/** UI Review-with-agent (`review`) and auto-review (`pr-review`). */
export function isPrReviewRun(run: AgentRun): boolean {
  const action = run.spec.activity?.action;
  return action === "review" || action === "pr-review";
}

/** Archive finished review chats so they leave the AionUi sidebar. Failures are ignored. */
export async function archiveFinishedPrReview(
  client: Pick<AionClient, "archiveConversation">,
  run: AgentRun,
): Promise<boolean> {
  if (!isPrReviewRun(run) || isActiveAgentRunState(run.status.state) || run.status.sidebarArchivedAt) return false;
  const conversationId = run.status.conversationId;
  if (!conversationId) return false;
  try {
    await client.archiveConversation(conversationId);
    return true;
  } catch (error) {
    return error instanceof AionRequestError && error.status === 404;
  }
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (typeof message.content === "object" && message.content && "content" in message.content && typeof message.content.content === "string") return message.content.content;
  return "";
}

function isError(message: Message): boolean {
  return message.status === "error" || message.type === "error" ||
    (message.type === "tips" && typeof message.content === "object" && message.content !== null && "type" in message.content && message.content.type === "error");
}

/** Slice by the submitted user message, never by the currently selected/latest turn. */
export function managedTurnOutcome(run: AgentRun, conversation: AionConversation, messages: Message[]): Partial<AgentRunStatus> {
  const runtime = conversation.runtime;
  const ownTurnActive = runtime?.turn_id === run.status.turnId;
  if (runtime && ownTurnActive) {
    const state = activeRuntimeState(runtime);
    if (state) return { state, connectivity: "connected" };
  }
  const start = messages.findIndex((message) => message.id === run.status.messageId || message.msg_id === run.status.messageId);
  if (start < 0) return { state: "needs-attention", error: "The submitted message could not be reconciled. Open the conversation before retrying." };
  const following = messages.slice(start + 1);
  const nextUser = following.findIndex((message) => message.position === "right");
  const turn = nextUser < 0 ? following : following.slice(0, nextUser);
  const error = turn.find(isError);
  if (error) return { state: "failed", finishedAt: Date.now(), error: clip(messageText(error) || "The agent reported a failure.", 2000) };
  const processing = runtime && activeRuntimeState(runtime);
  if (processing && (ownTurnActive || !runtime.turn_id)) return { state: processing };
  if (run.status.cancelRequestedAt) return { state: "cancelled", finishedAt: Date.now(), error: undefined };
  const finalText = turn.filter((message) => message.position === "left" && message.type === "text" && message.status === "finish").map(messageText).join("\n\n").trim();
  if (finalText && (conversation.status === "finished" || nextUser >= 0)) {
    // This API persists output and an idle state, but not the harness's terminal
    // reason. A partial reply followed by a stop must never become "succeeded".
    return { state: "completed", finishedAt: Date.now(), resultText: clip(finalText, 8000), error: undefined };
  }
  return { state: "needs-attention", error: "The turn stopped without a confirmed result. Open the conversation to inspect it." };
}

async function turnMessages(client: AionClient, run: AgentRun): Promise<Message[]> {
  let page = await client.getMessages(run.status.conversationId!, undefined, run.status.messageId);
  const items = [...page.items];
  const seen = new Set<string>();
  while (page.has_more_after && page.newest_cursor && !seen.has(page.newest_cursor)) {
    seen.add(page.newest_cursor);
    page = await client.getMessages(run.status.conversationId!, page.newest_cursor);
    items.push(...page.items);
    if (items.length > 10_000) throw new Error("The conversation is too large to reconcile automatically. Open it to inspect the result.");
  }
  return [...new Map(items.map((item) => [item.id, item])).values()];
}


/** Cursor/Copilot have no real YOLO mode — confirm pending ACP prompts for DevHub-managed chats. */
export async function autoConfirmPendingPermissions(client: AionClient, conversation: AionConversation): Promise<number> {
  const runtime = conversation.runtime;
  if (!runtime || (runtime.pending_confirmations <= 0 && runtime.state !== "waiting_confirmation")) return 0;
  if (!conversationWantsAutoconfirm(conversation)) return 0;
  const pending = await client.listConfirmations(conversation.id);
  let confirmed = 0;
  for (const item of pending) {
    const options = item.options || [];
    const prefer = options.find((opt) => opt.value === "allow-always")
      || options.find((opt) => opt.value === "allow-once")
      || options[0];
    const data = prefer?.value || "allow-always";
    try {
      await client.confirmPermission(conversation.id, item.call_id, data);
      confirmed += 1;
    } catch {
      /* Leave needs-attention; next tick retries. */
    }
  }
  return confirmed;
}

export async function reconcileManagedRun(input: AgentRun): Promise<AgentRun> {
  if (input.spec.runtime !== "aionui" || !isActiveAgentRunState(input.status.state)) return input;
  return withMutex(`aion:${input.spec.id}`, async () => {
    const run = readAgentRun(input.spec.id) ?? input;
    if (!isActiveAgentRunState(run.status.state)) return run;
    try {
      const session = await currentAionSession();
      if (aionConnectionId(session) !== run.status.connectionId) return updateAgentRunStatus(run, { state: "needs-attention", error: "This run belongs to a different AionUi connection. Reconnect its original workspace to continue." });
      const client = new AionClient(session);
      await client.verifyConnection();
      if (!run.status.conversationId || !run.status.messageId || !run.status.turnId) {
        // Dispatch may still be preparing a worktree or awaiting acknowledgement.
        if (Date.now() - run.spec.createdAt < 120_000) return run;
        return updateAgentRunStatus(run, { state: "needs-attention", error: "Startup was interrupted or its acknowledgement was lost. Check AionUi before starting another attempt." });
      }
      let conversation = await client.getConversation(run.status.conversationId);
      if (await autoConfirmPendingPermissions(client, conversation) > 0) {
        conversation = await client.getConversation(run.status.conversationId);
      }
      const runtime = conversation.runtime;
      if (runtime?.turn_id === run.status.turnId && activeRuntimeState(runtime)) return updateAgentRunStatus(run, { state: activeRuntimeState(runtime)!, connectivity: "connected" });
      const patch = managedTurnOutcome(run, conversation, await turnMessages(client, run));
      const updated = withAgentAdmission(() => {
      const latest = readAgentRun(run.spec.id) ?? run;
      if (!isActiveAgentRunState(latest.status.state)) return latest;
      if (patch.state && !isActiveAgentRunState(patch.state)) {
        if (patch.state === "completed") appendRunEvent(run.dir, { type: "text", text: patch.resultText || "The conversation has stopped. Inspect its result in Agents.", seq: run.status.eventCount, ts: Date.now() });
        else appendRunEvent(run.dir, { type: "result", ok: patch.state === "succeeded", text: patch.resultText || patch.error || patch.state, seq: run.status.eventCount, ts: Date.now() });
        patch.eventCount = run.status.eventCount + 1;
      }
      return updateAgentRunStatus(run, { ...patch, connectivity: "connected" });
      });
      if (await archiveFinishedPrReview(client, updated)) {
        return updateAgentRunStatus(updated, { sidebarArchivedAt: Date.now() });
      }
      return updated;
    } catch (error) {
      if (error instanceof AionRequestError && error.status === 404) return updateAgentRunStatus(run, { state: "needs-attention", error: "The conversation is no longer available in AionUi." });
      return updateAgentRunStatus(run, { connectivity: "reconnecting", error: error instanceof Error ? error.message : "AionUi is unavailable." });
    }
  });
}

export async function cancelManagedRun(input: AgentRun) {
  const run = await reconcileManagedRun(input);
  if (!isActiveAgentRunState(run.status.state)) return { run, outcome: "already-finished" };
  if (!run.status.conversationId || !run.status.turnId) throw new Error("Open AionUi to inspect this interrupted start; no acknowledged turn is available to stop.");
  const session = await currentAionSession();
  if (aionConnectionId(session) !== run.status.connectionId) throw new Error("Reconnect this run's original AionUi workspace before stopping it.");
  const client = new AionClient(session);
  const conversation = await client.getConversation(run.status.conversationId);
  if (conversation.runtime?.turn_id !== run.status.turnId) return { run: await reconcileManagedRun(run), outcome: "already-finished" };
  const acknowledgement = await client.cancelTurn(run.status.conversationId, run.status.turnId);
  if (acknowledgement.runtime.turn_id && acknowledgement.runtime.turn_id !== run.status.turnId) return { run: await reconcileManagedRun(run), outcome: "already-finished" };
  const updated = updateAgentRunStatus(run, { cancelRequestedAt: Date.now() });
  return { run: await reconcileManagedRun(updated), outcome: "cancel-requested" };
}

let timer: ReturnType<typeof setInterval> | undefined;
let polling = false;
export function startAionReconciliation() {
  if (timer) return;
  const tick = async () => {
    if (polling) return;
    if (!readAionSession()) return;
    polling = true;
    try {
      const session = readAionSession();
      const client = session ? new AionClient(session) : null;
      for (const run of listAgentRuns(Number.MAX_SAFE_INTEGER)) {
        if (run.spec.runtime === "aionui" && isActiveAgentRunState(run.status.state)) await reconcileManagedRun(run);
        else if (client && run.spec.runtime === "aionui" && await archiveFinishedPrReview(client, run)) {
          updateAgentRunStatus(run, { sidebarArchivedAt: Date.now() });
        }
      }
      try { await indexAionConversations(); } catch { /* Run cards already show connectivity; retain the last conversation index. */ }
    } finally { polling = false; }
  };
  timer = setInterval(() => { void tick().catch((error: unknown) => console.error("[agents] reconciliation failed", error)); }, 5_000);
  timer.unref();
}
