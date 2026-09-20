/** Server-owned dispatch. Starting work never opens or targets a user interface. */
import { agentBudgets,costRefusalMessage,spentToday } from "@/lib/agent-runs/budget";
import { clip } from "@/lib/agent-runs/events";
import { createRunWorktree,gitHead,type AgentWorktreeLabel } from "@/lib/agent-runs/git";
import { parseJiraIssueKey } from "@/lib/entity-note";
import { getTasks } from "@/lib/tasks/storage";
import { writeRunSpec,type AgentActivityContext,type AgentRunWorktree } from "@/lib/agent-runs/run-files";
import {
agentRunDir,
countActiveAgentRuns,
createAgentRun,
listAgentRuns,
newAgentRunId,
readAgentRun,
updateAgentRunStatus,
type AgentRun,
} from "@/lib/agent-runs/store";
import { aionCatalog,assistantForProvider } from "@/lib/aionui/catalog";
import { modelAllowedForAssistant, resolveAionDispatchDefaults } from "@/lib/aionui/dispatch-defaults";
import { AionRequestError } from "@/lib/aionui/client";
import { aionConnectionId } from "@/lib/aionui/connection";
import { upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimAgentRequest,readAgentRequest,withAgentAdmission } from "./claims";

export class AgentDispatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentDispatchError";
  }
}

export interface AgentDispatchInput {
  requestId?: string;
  activity?: AgentActivityContext;
  provider: string;
  prompt: string;
  cwd: string;
  title?: string;
  model?: string;
  /** Run in an isolated git worktree instead of the checkout itself. */
  worktree?: boolean;
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

function defaultTitle(prompt: string): string {
  const firstLine = prompt.trim().split("\n")[0] ?? "";
  return clip(firstLine, 60);
}

export async function dispatchAgentRun(input: AgentDispatchInput): Promise<AgentRun> {
  if (!input.prompt.trim() || input.prompt.length > 32_000) throw new AgentDispatchError("A prompt between 1 and 32,000 characters is required.", 400);
  const maxDepth = envInt("DEVHUB_AGENT_MAX_DEPTH", 1);
  if (input.depth >= maxDepth) {
    throw new AgentDispatchError(
      `Nested dispatch refused: the caller is already an agent run (depth ${input.depth}, DEVHUB_AGENT_MAX_DEPTH=${maxDepth}).`,
      409,
    );
  }

  let catalog: Awaited<ReturnType<typeof aionCatalog>>;
  try { catalog = await aionCatalog(); } catch (error) { throw new AgentDispatchError(error instanceof Error ? error.message : "Connect AionUi in Agents.", 503); }
  const { client, session, assistants } = catalog;
  const defaults = resolveAionDispatchDefaults({
    provider: input.provider || session.defaultAssistantId,
    model: input.model,
    assistants,
  });
  const assistant = assistantForProvider(assistants, defaults.provider);
  if (!assistant?.enabled || assistant.agent_status !== "online") throw new AgentDispatchError("The selected agent is not ready. Check it in AionUi's Assistants view.", 400);
  if (!modelAllowedForAssistant(assistant, defaults.model)) throw new AgentDispatchError("The selected model is not advertised by this assistant. Choose its default model or configure it in AionUi.", 400);
  const model = defaults.model;
  const permission = defaults.permission;
  const autoconfirmPermissions = defaults.autoconfirmPermissions;

  if (input.requestId) {
    const existingId = readAgentRequest(input.requestId);
    if (existingId) {
      const existing = readAgentRun(existingId);
      if (!existing) throw new AgentDispatchError("This request was already claimed. Check Activity before retrying.", 409);
      if (existing.spec.prompt !== input.prompt || existing.spec.model !== model) throw new AgentDispatchError("This request already started with different content. Open its activity or start a new handoff.", 409);
      return existing;
    }
  }
  if (input.maxTurns !== undefined) throw new AgentDispatchError("This AionUi release does not support DevHub's max-turns override. Use the agent's own controls in AionUi.", 400);
  const connectionId = aionConnectionId(session);
  const parent = input.parentRunId ? readAgentRun(input.parentRunId) : null;
  if (input.resumeSessionId && (!parent || parent.spec.runtime !== "aionui" || parent.status.connectionId !== connectionId || parent.status.conversationId !== input.resumeSessionId || parent.spec.provider !== assistant.id)) {
    throw new AgentDispatchError("This session cannot be continued through AionUi. Start a new conversation with its saved handoff.", 400);
  }

  const budgets = agentBudgets();
  if (budgets.maxCostUsd > 0) {
    const spent = spentToday(listAgentRuns(Number.MAX_SAFE_INTEGER));
    if (spent >= budgets.maxCostUsd) {
      throw new AgentDispatchError(costRefusalMessage(spent, budgets.maxCostUsd), 429);
    }
  }

  const maxActive = envInt("DEVHUB_AGENT_MAX_RUNS", 6);
  let cwd = validateAgentCwd(input.cwd);
  const id = newAgentRunId();
  const dir = agentRunDir(id);
  if (!dir) throw new Error(`Generated an invalid run id: ${id}`);
  let alreadyClaimed = false;
  let run = withAgentAdmission(() => {
  const priorId = input.requestId ? readAgentRequest(input.requestId) : null;
  if (priorId) {
    const prior = readAgentRun(priorId);
    if (!prior || prior.spec.prompt !== input.prompt || prior.spec.model !== model) throw new AgentDispatchError("This request was already claimed with different content. Check Activity.", 409);
    alreadyClaimed = true;
    return prior;
  }
  if (countActiveAgentRuns() >= maxActive) throw new AgentDispatchError(`${maxActive} agent runs are already active. Wait for one or cancel it.`, 429);
  if (input.requestId) {
    const claimed = claimAgentRequest(input.requestId, id);
    if (claimed !== id) {
      const existing = readAgentRun(claimed);
      if (existing) { alreadyClaimed = true; return existing; }
      throw new AgentDispatchError("This request was already claimed. Check Activity before retrying.", 409);
    }
  }

  return createAgentRun({ id, schemaVersion: 2, runtime: "aionui", requestId: input.requestId,
    activity: input.activity ?? { source: input.scheduledJobId ? "schedule" : input.unattendedReason ? "investigation" : "interactive", action: "agent", jobId: input.scheduledJobId },
    provider: assistant.id, providerLabel: assistant.name, bin: "aionui", args: [], format: "text", cwd,
    title: input.title?.trim() || defaultTitle(input.prompt), prompt: input.prompt, model,
    depth: input.depth, createdAt: Date.now(), parentRunId: input.parentRunId,
  });
  });
  if (alreadyClaimed) return run;
  run = updateAgentRunStatus(run, { state: "starting", connectionId, connectivity: "connected" });

  try {

  if (input.activity?.taskId && input.activity.action !== "plan") {
    await upsertTaskAgentRun({ taskId: input.activity.taskId, runId: id, status: "queued", provider: assistant.id });
  }

  const inherit = input.resumeSessionId && parent ? { worktree: parent.spec.worktree, baseSha: parent.spec.baseSha } : input.inherit;
  if (input.resumeSessionId && parent) cwd = validateAgentCwd(parent.spec.cwd);
  let worktree = inherit?.worktree;
  let baseSha = inherit?.baseSha;
  // Isolation is the default: a caller that means to edit the live checkout
  // says worktree: false. DEVHUB_AGENT_DEFAULT_WORKTREE=0 restores the old
  // shared-checkout-by-default behaviour.
  const wantWorktree =
    input.worktree ?? envInt("DEVHUB_AGENT_DEFAULT_WORKTREE", 1) !== 0;
  if (!inherit) {
    if (wantWorktree) {
      try {
        const created = await createRunWorktree(cwd, id, worktreeLabelForDispatch(input, run.spec.title));
        worktree = created.worktree;
        baseSha = created.baseSha;
        cwd = created.cwd;
      } catch (err) { throw new AgentDispatchError(err instanceof Error ? err.message : String(err), 400); }
    } else {
      baseSha = await gitHead(cwd);
    }
  }

    run.spec = { ...run.spec, cwd, baseSha, worktree };
    writeRunSpec(run.dir, run.spec);
    let mcpIds: string[] = [];
    if (!input.resumeSessionId) {
      try { mcpIds = await client.listEnabledMcpIds(); } catch { /* create without MCP attach */ }
    }
    const conversation = input.resumeSessionId
      ? await client.getConversation(input.resumeSessionId)
      : await client.createConversation({
          assistantId: assistant.id,
          title: run.spec.title,
          cwd,
          runId: id,
          model,
          permission,
          autoconfirmPermissions,
          mcpIds,
        });
    run = updateAgentRunStatus(run, { conversationId: conversation.id, sessionId: conversation.id });
    // Persist intent before the non-idempotent write. A restart must never send it twice.
    run = updateAgentRunStatus(run, { submissionAttemptedAt: Date.now() });
    const accepted = await client.sendMessage(conversation.id, input.prompt);
    if (accepted.delivered_midturn) return updateAgentRunStatus(run, { state: "needs-attention", messageId: accepted.msg_id, turnId: accepted.turn_id, error: "The conversation became busy during submission. Open it to inspect the delivered message." });
    return updateAgentRunStatus(run, { state: "running", startedAt: Date.now(), messageId: accepted.msg_id, turnId: accepted.turn_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const ambiguous = err instanceof AionRequestError && err.ambiguous;
    run = updateAgentRunStatus(run, { state: ambiguous ? "needs-attention" : "failed", ...(ambiguous ? {} : { finishedAt: Date.now() }), error: message });
    // Return the durable record even when startup failed so the caller can open it.
    return run;
  }
}
