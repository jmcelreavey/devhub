import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import fs from "node:fs";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { SelectionSchema, selectionContext } from "@/lib/editor/selection";
import { editorWorkspace, selectionPath } from "@/lib/editor/workspace";
import { AgentDispatchError, dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { listAgentRuns, readAgentRun, toAgentRunSummary } from "@/lib/agent-runs/store";
import { readAgentRequest } from "@/lib/agent-runs/claims";
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { currentTaskNode, loadTaskIndex } from "@/lib/tasks/task-index";
import { ensureTasksMigrated } from "@/lib/tasks/storage";
import { reconcileManagedRun } from "@/lib/paseo/lifecycle";

const Input = z.object({
  selection: SelectionSchema,
  send: z.object({
    requestId: z.string().uuid(),
    question: z.string().trim().min(1).max(8000),
    provider: z.string().min(1).max(200),
    runId: z.string().max(100).optional(),
    taskId: z.string().max(100).optional(),
  }).optional(),
}).strict();

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, Input);
  if (!parsed.ok) return parsed.response;
  try {
    const { selection, send } = parsed.data;
    const cwd = editorWorkspace(selection.workspaceId);
    selectionPath(cwd, selection.relativePath);
    await ensureTasksMigrated();
    const index = loadTaskIndex();
    const sameWorkspace = (folder: string) => {
      try { return fs.realpathSync(folder) === cwd; } catch { return false; }
    };
    if (!send) {
      const runs = await Promise.all(listAgentRuns(500).filter((run) => run.spec.runtime === "paseo" && sameWorkspace(run.spec.cwd)).slice(0, 40).map(reconcileManagedRun));
      const tasks = [...new Map([...index.byId.values()].map((node) => [node.task.id, { id: node.task.id, text: node.task.text }])).values()];
      return NextResponse.json({ runs: runs.map((run) => ({ id: run.spec.id, title: run.spec.title, provider: run.spec.provider, taskId: run.spec.activity?.taskId, busy: isActiveAgentRunState(run.status.state), resumable: Boolean(run.status.conversationId) })), tasks });
    }
    const parent = send.runId ? readAgentRun(send.runId) : null;
    if (send.runId && (!parent || !sameWorkspace(parent.spec.cwd) || !parent.status.conversationId)) throw new AgentDispatchError("That conversation does not belong to this checkout or is unavailable.", 409);
    const linkedId = parent?.spec.activity?.taskId ?? send.taskId;
    if (parent && send.taskId && send.taskId !== linkedId) throw new AgentDispatchError("Keep the existing conversation linked to its original task.", 409);
    const node = linkedId ? currentTaskNode(index, linkedId) : null;
    if (linkedId && !node) throw new AgentDispatchError("The linked task is no longer available.", 404);
    const claimedId = readAgentRequest(send.requestId);
    const claimed = claimedId ? readAgentRun(claimedId) : null;
    if (claimed && (claimed.spec.cwd !== cwd || claimed.spec.activity?.taskId !== node?.task.id || claimed.spec.parentRunId !== parent?.spec.id || claimed.spec.provider !== (parent?.spec.provider ?? send.provider))) throw new AgentDispatchError("This selection was already sent to another conversation. Check Agents before starting a new request.", 409);
    const run = await dispatchAgentRun({
      requestId: send.requestId, cwd, worktree: false, depth: 0,
      provider: parent?.spec.provider ?? send.provider,
      parentRunId: parent?.spec.id, resumeSessionId: parent?.status.conversationId,
      title: "Discuss " + selection.relativePath.slice(-65),
      prompt: send.question + "\n\nExplain the selection. Do not edit files or publish changes unless the user explicitly asks.\n\n" + selectionContext(selection),
      activity: { source: "interactive", action: "discuss", repoName: selection.workspaceId, taskId: node?.task.id, taskDate: node?.date },
    });
    return NextResponse.json({ run: toAgentRunSummary(run) });
  } catch (error) {
    if (error instanceof AgentDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, "editor.selection");
