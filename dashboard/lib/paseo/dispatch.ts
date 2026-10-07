import type { PaseoWorkspaceHandle } from "@getpaseo/client";
import type { AgentRun } from "@/lib/agent-runs/store";
import { withPaseo, type PaseoSession } from "./client";
import type { PaseoLaunch } from "./launch";

export interface PaseoStart {
  agentId: string;
  /** clientMessageId on the submitted user message — how reconcile finds this run's turn. */
  messageId: string;
  /** Workspace DevHub pinned for this run; reconcile releases it when the task moves on. */
  pinnedWorkspaceId?: string;
}

/** Plan and implement chats are the live part of a task, so they get a pinned workspace of their own. */
function isPinnedTaskRun(run: AgentRun): boolean {
  const activity = run.spec.activity;
  return Boolean(activity?.taskId) && (activity?.action === "plan" || activity?.action === "implement");
}

/** Best effort: the prompt already went out, so a failed pin must not fail the run. A user's own pin is left alone. */
async function pinWorkspace(daemon: PaseoSession["daemon"], workspace: PaseoWorkspaceHandle): Promise<string | undefined> {
  if (workspace.current()?.pinnedAt) return undefined;
  try {
    await daemon.setWorkspacePinned(workspace.id, true);
    return workspace.id;
  } catch (error) {
    console.warn("[agents] could not pin the task workspace", error);
    return undefined;
  }
}

/** Creates the agent with its first prompt in one request, or sends a follow-up to an existing one. */
export async function startPaseoAgent(input: { run: AgentRun; launch: PaseoLaunch; prompt: string; resumeAgentId?: string; onSubmission: (messageId: string) => void }): Promise<PaseoStart> {
  const { run, launch, prompt } = input;
  const messageId = `devhub-${run.spec.id}`;
  return withPaseo(async ({ api, daemon }) => {
    if (input.resumeAgentId) {
      const existing = await daemon.fetchAgent(input.resumeAgentId);
      if (!existing) throw new Error("The Paseo agent no longer exists.");
      if (existing.agent.status === "running" || existing.agent.status === "initializing" || existing.agent.pendingPermissions.length) {
        throw new Error("The Paseo chat is busy. Wait for its current turn before continuing.");
      }
      const modelId = launch.config.provider.slice(launch.provider.length + 1);
      await daemon.applyAgentConfig(input.resumeAgentId, {
        ...(modelId !== "default" ? { modelId } : {}),
        modeId: launch.config.modeId,
        thinkingOptionId: launch.config.thinkingOptionId,
        featureValues: launch.config.featureValues,
      });
      input.onSubmission(messageId);
      await api.agents.ref(input.resumeAgentId).send(prompt, { messageId });
      return { agentId: input.resumeAgentId, messageId };
    }
    // DevHub owns these isolated checkouts. Shared checkouts and user titles stay stable.
    const pinTask = isPinnedTaskRun(run);
    const workspace = run.spec.worktree?.path === run.spec.cwd
      ? await api.workspaces.open(run.spec.cwd)
      // A task chat on a shared checkout gets its own workspace, so pinning it doesn't pin the checkout's other chats.
      : pinTask ? await api.workspaces.create({ title: run.spec.title, source: { kind: "directory", path: run.spec.cwd } })
      : undefined;
    if (workspace && !workspace.current()?.title) await workspace.setTitle(run.spec.title);
    input.onSubmission(messageId);
    const options = {
      cwd: run.spec.cwd,
      title: run.spec.title,
      config: launch.config,
      prompt,
      env: launch.env,
      clientMessageId: messageId,
      labels: { devhubRunId: run.spec.id, ...(run.spec.activity?.action ? { devhubAction: run.spec.activity.action } : {}) },
    };
    const agent = workspace ? await workspace.agents.create(options) : await api.agents.create(options);
    const pinnedWorkspaceId = workspace && pinTask ? await pinWorkspace(daemon, workspace) : undefined;
    return { agentId: agent.id, messageId, ...(pinnedWorkspaceId ? { pinnedWorkspaceId } : {}) };
  });
}
